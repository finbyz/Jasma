# apps/<your_app>/<your_app>/page/stock_traceability/stock_traceability.py
#
# Implements "Delivery Note Stock Backtracking Logic" (see DN_Stock_Backtracking_Logic.docx)
# 100% computed live from Stock Ledger Entry (SLE). Nothing is stored.
#
# HOW TO WIRE THIS IN:
#   1. Drop this file, stock_traceability.js and stock_traceability.json into:
#      <your_app>/<your_app>/page/stock_traceability/
#   2. bench build / bench restart, then open the "Stock Source Traceability" page from Desk.
#
# ASSUMPTIONS YOU SHOULD REVIEW (marked inline with "ASSUMPTION:"):
#   - Item valuation method is FIFO (the doc's core guarantee only holds for FIFO).
#     Moving Average items are flagged, not traced (per Section 3 of the doc).
#   - ERPNext-style doctypes/fieldnames: Purchase Receipt Item.purchase_order /
#     purchase_order_item, Purchase Order Item.material_request, Subcontracting
#     Receipt (new subcontracting flow) with subcontracting_order + supplier_warehouse,
#     Subcontracting Receipt Supplied Item, Stock Entry Detail (s_warehouse/t_warehouse/
#     is_finished_item). Adjust field names if your version differs (e.g. old-style
#     "Subcontracting" via Purchase Receipt + Stock Entry only).
#   - "AO Number" is resolved against the standard "Project" doctype.
#       * Sales Order -> Project link: Sales Order.project = <AO>
#       * Delivery Note -> Project link: Delivery Note Item.project = <AO>
#         (project lives on the DN's child table, not the DN itself, so this
#         needs a join — see _delivery_notes_for_project() / dn_query_for_project()).
#     If your Assembly Order lives on a different doctype/field, update
#     get_links_from_ao() and dn_query_for_project() accordingly.
#   - A Delivery Note, Sales Order, or AO Number selection is now MANDATORY.
#     get_dn_traceability() requires at least one of delivery_note,
#     delivery_notes, or an explicit scope — calling it with none of these
#     raises a validation error instead of silently falling back to "recent
#     Delivery Notes". Company is only ever a secondary narrowing filter.
#
# NOTE ON REMOVED "Period" FILTER:
#   An earlier version of this page had a Period preset (This Financial Year /
#   Custom Range / etc.) driving a "recent DN" fallback lookup. That fallback
#   (and the Period preset that used to gate it) has been removed entirely per
#   requirements — the page now requires an explicit AO Number, Sales Order,
#   or Delivery Note before it will trace anything.

import frappe
from frappe.utils import flt, cstr

EPSILON = 1e-6
MAX_DEPTH = 12  # safety guard against pathological recursion / cyclic data
DEFAULT_FETCH_LIMIT = 20  # safety cap on how many DNs get traced in one go,
# when an explicit delivery_notes list (e.g. every DN under an AO / Sales
# Order) is passed.


# --------------------------------------------------------------------------- #
# Stage 1 — Backward scan (Section 4 of the doc)
# --------------------------------------------------------------------------- #

def stage1_backward_scan(item_code, warehouse, target_qty, before_datetime):
	if flt(target_qty) <= EPSILON:
		return [], 0.0

	rows = frappe.db.sql(
		"""
		select name, actual_qty, incoming_rate, voucher_type, voucher_no,
		       timestamp(posting_date, posting_time) as posting_datetime
		from `tabStock Ledger Entry`
		where item_code = %(item_code)s
		  and warehouse = %(warehouse)s
		  and actual_qty > 0
		  and is_cancelled = 0
		  and timestamp(posting_date, posting_time) < %(before)s
		order by posting_date desc, posting_time desc, creation desc
		""",
		{"item_code": item_code, "warehouse": warehouse, "before": before_datetime},
		as_dict=True,
	)

	lots, covered = [], 0.0
	for r in rows:
		remaining_needed = target_qty - covered
		if remaining_needed <= EPSILON:
			break
		take = min(flt(r.actual_qty), remaining_needed)
		lots.append(
			{
				"sle": r.name,                      # NEW — needed for clickable SLE refs
				"qty": take,
				"rate": r.incoming_rate,
				"voucher_type": r.voucher_type,
				"voucher_no": r.voucher_no,
				"posting_datetime": r.posting_datetime,
			}
		)
		covered += take
	return lots, covered

def _diagnose_shortfall(item_code, warehouse, before_datetime):
	"""When the backward scan can't cover the needed qty, work out WHY
	instead of just labelling it "Opening Stock". Read-only — never changes
	what's traced, only what's reported for the untraced remainder."""
	item_name = frappe.db.get_value("Item", item_code, "item_name") or item_code

	# Is there an inward SLE for this exact item+warehouse that's simply
	# dated AFTER this delivery? (stock arrived, just too late to be the
	# source — the most common cause of a "false" Opening Stock label.)
	future_row = frappe.db.sql(
		"""
		select name, voucher_type, voucher_no,
		       timestamp(posting_date, posting_time) as posting_datetime
		from `tabStock Ledger Entry`
		where item_code = %(item_code)s and warehouse = %(warehouse)s
		  and actual_qty > 0 and is_cancelled = 0
		  and timestamp(posting_date, posting_time) >= %(before)s
		order by posting_date asc, posting_time asc limit 1
		""",
		{"item_code": item_code, "warehouse": warehouse, "before": before_datetime},
		as_dict=True,
	)
	if future_row:
		f = future_row[0]
		return {
			"item_name": item_name,
			"hint_entry": f.voucher_no, "hint_entry_type": f.voucher_type, "hint_sle": f.name,
			"note": (
				f"No inward stock found before this date for {item_name} ({item_code}) in "
				f"{warehouse}. Nearest inward entry is {f.voucher_type} {f.voucher_no} "
				f"({f.posting_datetime}) — but it's dated AFTER this delivery, so it can't "
				f"be the source. Check the posting dates."
			),
		}

	# Is there an inward SLE for this item in a DIFFERENT warehouse before
	# this date? (likely a missing/broken Material Transfer leg.)
	other_wh_row = frappe.db.sql(
		"""
		select name, warehouse, voucher_type, voucher_no,
		       timestamp(posting_date, posting_time) as posting_datetime
		from `tabStock Ledger Entry`
		where item_code = %(item_code)s and warehouse != %(warehouse)s
		  and actual_qty > 0 and is_cancelled = 0
		  and timestamp(posting_date, posting_time) < %(before)s
		order by posting_date desc, posting_time desc limit 1
		""",
		{"item_code": item_code, "warehouse": warehouse, "before": before_datetime},
		as_dict=True,
	)
	if other_wh_row:
		o = other_wh_row[0]
		return {
			"item_name": item_name,
			"hint_entry": o.voucher_no, "hint_entry_type": o.voucher_type, "hint_sle": o.name,
			"note": (
				f"No inward stock for {item_name} ({item_code}) in {warehouse} before this "
				f"date. It WAS received into a different warehouse ({o.warehouse}) via "
				f"{o.voucher_type} {o.voucher_no} — likely a missing Material Transfer "
				f"into {warehouse}."
			),
		}

	# Genuinely nothing anywhere — real opening stock / reconciliation.
	return {
		"item_name": item_name, "hint_entry": None, "hint_entry_type": None, "hint_sle": None,
		"note": (
			f"No inward Stock Ledger Entry exists anywhere for {item_name} ({item_code}) "
			f"before this date — genuine opening stock, a stock reconciliation, or "
			f"negative stock."
		),
	}

def split_front(lots, front_qty):
	"""Given newest-first lots, split off the most recent `front_qty` worth
	(= stock still remaining) from the rest (= actually consumed). Matches the
	worked example in Section 4: partial lots are split at the boundary."""
	kept, remaining, used = [], [], 0.0
	for lot in lots:
		if used >= front_qty - EPSILON:
			remaining.append(dict(lot))
			continue
		need = front_qty - used
		if lot["qty"] <= need + EPSILON:
			kept.append(dict(lot))
			used += lot["qty"]
		else:
			kept.append({**lot, "qty": need})
			remaining.append({**lot, "qty": lot["qty"] - need})
			used = front_qty
	return kept, remaining


# --------------------------------------------------------------------------- #
# Stage 2 — Resolve each consumed lot to its source (Section 5)
# --------------------------------------------------------------------------- #

def build_branches(item_code, warehouse, qty, before_datetime, depth=0):
	"""Full recursive trace for `qty` of `item_code` in `warehouse` as of
	before_datetime. Returns a flat list of branch dicts:
	{qty, chain:[{t,title,sub,qty}], src, po, rm?, via?, untraced?}
	"""
	if depth > MAX_DEPTH:
		return [{"qty": qty, "untraced": True, "note": "Max trace depth reached"}]

	lots, covered = stage1_backward_scan(item_code, warehouse, qty, before_datetime)
	branches = []
	for lot in lots:
		branches.extend(resolve_lot(lot, item_code, warehouse, depth))

	shortfall = qty - covered
	if shortfall > EPSILON:
		# No earlier inward SLE found (opening stock / stock reconciliation /
		# negative stock) — nothing further to trace for this portion.
		branches.append({
			"qty": shortfall,
			"untraced": True,
			"note": (
				"Opening stock, stock reconciliation, or negative stock  no inward SLE found for this portion"
			),
		})
	return branches


def resolve_lot(lot, item_code, warehouse, depth):
	vt = lot["voucher_type"]
	if vt == "Purchase Receipt":
		return resolve_purchase_receipt(lot, item_code, warehouse)
	if vt == "Subcontracting Receipt":
		return resolve_subcontracting_receipt(lot, item_code, warehouse, depth)
	if vt == "Stock Entry":
		return resolve_stock_entry(lot, item_code, warehouse, depth)

	# Anything else (Stock Reconciliation, Purchase Invoice w/ update_stock, etc.)
	# is treated as a terminal document — no further doc-chain to follow.
	return [
		{
			"qty": lot["qty"],
			"chain": [_node("doc", vt, lot["voucher_no"], lot["qty"])],
			"src": lot["voucher_no"],
			"po": None,
		}
	]


def resolve_purchase_receipt(lot, item_code, warehouse):
	"""Section 5.1 + Section 7 — terminal node, resolve PO (and MR) from the PR row."""
	pr_row = frappe.db.get_value(
		"Purchase Receipt Item",
		{"parent": lot["voucher_no"], "item_code": item_code, "warehouse": warehouse},
		["purchase_order", "purchase_order_item"],
		as_dict=True,
	) or frappe.db.get_value(
		"Purchase Receipt Item",
		{"parent": lot["voucher_no"], "item_code": item_code},
		["purchase_order", "purchase_order_item"],
		as_dict=True,
	)

	chain = [_node("doc", "Purchase Receipt", lot["voucher_no"], lot["qty"])]
	po = None
	if pr_row and pr_row.purchase_order:
		po = pr_row.purchase_order
		chain.append(_node("order", "Purchase Order", po, lot["qty"]))
		if pr_row.purchase_order_item:
			mr = frappe.db.get_value(
				"Purchase Order Item",
				pr_row.purchase_order_item,
				["material_request", "material_request_item"],
				as_dict=True,
			)
			if mr and mr.material_request:
				chain.append(_node("request", "Material Request", mr.material_request, lot["qty"]))

	return [{"qty": lot["qty"], "chain": chain, "src": lot["voucher_no"], "po": po}]


_scr_order_field_cache = {}


def _scr_order_fieldname():
	"""Different Frappe/ERPNext versions have used different fieldnames on
	Subcontracting Receipt for the order it references (subcontracting_order
	vs purchase_order, depending on version/flow). Resolve whichever one
	actually exists on THIS site's doctype metadata instead of hard-coding
	it, so this doesn't break again on a version bump."""
	if "field" not in _scr_order_field_cache:
		meta = frappe.get_meta("Subcontracting Receipt")
		field = next(
			(f for f in ("subcontracting_order", "purchase_order") if meta.has_field(f)),
			None,
		)
		_scr_order_field_cache["field"] = field
	return _scr_order_field_cache["field"]


def resolve_subcontracting_receipt(lot, item_code, warehouse, depth):
	"""Section 5.2 — FG side is terminal (resolve SO/PO); RM side continues
	one level deeper via the supplied_items child table."""
	order_field = _scr_order_fieldname()
	fields = ["posting_date", "posting_time", "supplier_warehouse"]
	if order_field:
		fields.append(order_field)

	scr = frappe.db.get_value("Subcontracting Receipt", lot["voucher_no"], fields, as_dict=True)
	so_no = (scr and order_field and scr.get(order_field)) or None

	base_chain = [_node("doc", "Subcontracting Receipt", lot["voucher_no"], lot["qty"])]
	if so_no:
		base_chain.append(_node("order", "Subcontracting Order", so_no, lot["qty"]))

	scr_item_row = frappe.db.get_value(
		"Subcontracting Receipt Item",
		{"parent": lot["voucher_no"], "item_code": item_code},
		["name", "qty"],
		as_dict=True,
	)
	if not scr_item_row or not flt(scr_item_row.qty):
		return [{"qty": lot["qty"], "chain": base_chain, "src": lot["voucher_no"], "po": so_no}]

	ratio = lot["qty"] / flt(scr_item_row.qty)
	supplied = frappe.db.get_all(
		"Subcontracting Receipt Supplied Item",
		filters={"parent": lot["voucher_no"], "reference_name": scr_item_row.name},
		fields=["rm_item_code", "consumed_qty"],
	)
	if not supplied or not scr:
		return [{"qty": lot["qty"], "chain": base_chain, "src": lot["voucher_no"], "po": so_no}]

	before_dt = f"{scr.posting_date} {scr.posting_time}"
	subcontractor_wh = scr.supplier_warehouse  # ASSUMPTION: field holds subcontractor's stock loc

	branches = []
	for s in supplied:
		rm_qty = flt(s.consumed_qty) * ratio
		if rm_qty <= EPSILON or not subcontractor_wh:
			continue
		for rb in build_branches(s.rm_item_code, subcontractor_wh, rm_qty, before_dt, depth + 1):
			rb_rm_qty = rb["qty"]
			fg_qty = (rb_rm_qty / rm_qty) * lot["qty"] if rm_qty else 0
			rb["qty"] = fg_qty
			rb["chain"] = base_chain + [_node("warehouse", "Raw Material Consumed", s.rm_item_code, fg_qty)] + rb.get("chain", [])
			rb.setdefault("rm", s.rm_item_code)
			branches.append(rb)

	if not branches:
		branches = [{"qty": lot["qty"], "chain": base_chain, "src": lot["voucher_no"], "po": so_no}]
	return branches


def resolve_stock_entry(lot, item_code, warehouse, depth):
	"""Sections 5.3 / 5.4 / 5.5 — Stock Entry is a pass-through point."""
	se = frappe.db.get_value(
		"Stock Entry", lot["voucher_no"], ["purpose", "posting_date", "posting_time"], as_dict=True
	)
	if not se:
		return [{"qty": lot["qty"], "chain": [_node("doc", "Stock Entry", lot["voucher_no"], lot["qty"])],
		         "src": lot["voucher_no"], "po": None}]

	before_dt = f"{se.posting_date} {se.posting_time}"

	if se.purpose in ("Material Transfer", "Send to Subcontracting", "Material Transfer for Manufacture"):
		s_wh = frappe.db.get_value(
			"Stock Entry Detail",
			{"parent": lot["voucher_no"], "item_code": item_code, "t_warehouse": warehouse},
			"s_warehouse",
		) or frappe.db.get_value(
			"Stock Entry Detail", {"parent": lot["voucher_no"], "item_code": item_code}, "s_warehouse"
		)

		se_node = _node("doc", f"Stock Entry ({se.purpose})", lot["voucher_no"], lot["qty"])
		if not s_wh:
			return [{"qty": lot["qty"], "chain": [se_node], "src": lot["voucher_no"], "po": None,
			         "note": "Source warehouse not found"}]

		wh_node = _node("warehouse", "From Warehouse", s_wh, lot["qty"])
		out = []
		for rb in build_branches(item_code, s_wh, lot["qty"], before_dt, depth + 1):
			rb["chain"] = [se_node, wh_node] + rb.get("chain", [])
			rb["via"] = f"via {lot['voucher_no']}"
			out.append(rb)
		return out

	if se.purpose == "Manufacture":
		fg_qty_total = flt(
			frappe.db.get_value(
				"Stock Entry Detail",
				{"parent": lot["voucher_no"], "item_code": item_code, "is_finished_item": 1},
				"qty",
			)
		)
		ratio = (lot["qty"] / fg_qty_total) if fg_qty_total else 0
		rm_rows = frappe.db.get_all(
			"Stock Entry Detail",
			filters={"parent": lot["voucher_no"], "is_finished_item": 0, "s_warehouse": ["!=", ""]},
			fields=["item_code", "qty", "s_warehouse"],
		)
		se_node = _node("doc", "Stock Entry (Manufacture)", lot["voucher_no"], lot["qty"])

		out = []
		for r in rm_rows:
			rm_qty = flt(r.qty) * ratio
			if rm_qty <= EPSILON:
				continue
			for rb in build_branches(r.item_code, r.s_warehouse, rm_qty, before_dt, depth + 1):
				rb_rm_qty = rb["qty"]
				fg_eq = (rb_rm_qty / rm_qty) * lot["qty"] if rm_qty else 0
				rb["qty"] = fg_eq
				rb["chain"] = [se_node, _node("warehouse", "Raw Material", r.item_code, fg_eq)] + rb.get("chain", [])
				rb.setdefault("rm", r.item_code)
				out.append(rb)

		if not out:
			out = [{"qty": lot["qty"], "chain": [se_node], "src": lot["voucher_no"], "po": None,
			        "untraced": True, "note": "Raw material rows not found"}]
		return out

	# Repack or other purposes — treated as terminal.
	return [{"qty": lot["qty"], "chain": [_node("doc", f"Stock Entry ({se.purpose})", lot["voucher_no"], lot["qty"])],
	         "src": lot["voucher_no"], "po": None}]


def _node(t, title, sub, qty):
	return {"t": t, "title": title, "sub": cstr(sub), "qty": f"Qty: {flt(qty, 2)}"}


# --------------------------------------------------------------------------- #
# Delivery Note entry point (Section 8 — "Entry point for a Delivery Note SLE")
# --------------------------------------------------------------------------- #

def trace_delivery_note_item(dn_name, item_code, warehouse):
	dn_sle = frappe.db.get_value(
		"Stock Ledger Entry",
		{
			"voucher_type": "Delivery Note",
			"voucher_no": dn_name,
			"item_code": item_code,
			"warehouse": warehouse,
			"is_cancelled": 0,
		},
		["actual_qty", "qty_after_transaction", "posting_date", "posting_time"],
		as_dict=True,
	)
	if not dn_sle:
		return []

	consumed_qty = abs(flt(dn_sle.actual_qty))
	before_dt = f"{dn_sle.posting_date} {dn_sle.posting_time}"
	target = flt(dn_sle.qty_after_transaction) + consumed_qty

	all_lots, _covered = stage1_backward_scan(item_code, warehouse, target, before_dt)
	_still_in_stock, consumed_lots = split_front(all_lots, flt(dn_sle.qty_after_transaction))

	branches = []
	for lot in consumed_lots:
		branches.extend(resolve_lot(lot, item_code, warehouse, 0))

	consumed_sum = sum(b["qty"] for b in branches)
	untraced_qty = consumed_qty - consumed_sum
	if untraced_qty > EPSILON:
		branches.append({
			"qty": untraced_qty,
			"untraced": True,
			"note": (
				"Opening stock"
			),
		})

	return branches


def _is_fifo(item_code):
	"""Returns (is_fifo, resolved_method) — resolved_method is surfaced to the
	page so you can see WHY an item was skipped, instead of it just showing
	as an unexplained 0% traced."""
	method = frappe.db.get_value("Item", item_code, "valuation_method")
	if not method:
		method = frappe.db.get_single_value("Stock Settings", "valuation_method") or "FIFO"
	method = (method or "FIFO").upper()
	return method == "FIFO", method


def _is_finished_good(item_code):
	# ASSUMPTION: an item is treated as an FG/semi-finished item if it has an
	# active default BOM. Adjust to your own criteria (item group, flag, etc.)
	return bool(frappe.db.exists("BOM", {"item": item_code, "is_active": 1}))


def _clean_branch(b):
	b = dict(b)
	b["qty"] = flt(b.get("qty"), 2)
	b.setdefault("untraced", False)
	return b


def _trace_one_dn(dn_name):
	"""Trace every item on a single submitted Delivery Note. Returns a list of
	item dicts (each tagged with its `dn`)."""
	dn = frappe.get_doc("Delivery Note", dn_name)
	items = []
	for d in dn.items:
		is_fifo, valuation_method = _is_fifo(d.item_code)

		if is_fifo:
			branches = trace_delivery_note_item(dn_name, d.item_code, d.warehouse)
		else:
			# NOT a bug / NOT "no source found" — this item's valuation
			# method makes lot-level tracing inapplicable (see Section 3 of
			# the logic doc). Say so explicitly instead of leaving it blank.
			branches = [
				{
					"qty": flt(d.stock_qty, 2),
					"untraced": True,
					"skipped_valuation": True,
					"note": f"Valuation method is {valuation_method} — lot-level "
					f"tracing only applies to FIFO items, so this item was not traced.",
				}
			]

		traced_qty = sum(b["qty"] for b in branches if not b.get("untraced"))
		item_meta = frappe.db.get_value(
			"Item", d.item_code, ["item_name", "item_group", "stock_uom"], as_dict=True
		) or {}

		items.append(
			{
				"dn": dn_name,
				# AO Number lives on the Delivery Note Item child row (see
				# module docstring). Surfaced separately from `dn` so the
				# page can render it as its own clickable, distinctly
				# colored column/chip instead of folding it into the DN cell.
				"ao": getattr(d, "project", None) or None,
				"code": d.item_code,
				"name": item_meta.get("item_name") or d.item_code,
				"group": item_meta.get("item_group"),
				"uom": item_meta.get("stock_uom") or d.uom,
				"warehouse": d.warehouse,
				"delivered": flt(d.stock_qty, 2),
				"traced": flt(traced_qty, 2),
				"isFG": _is_finished_good(d.item_code),
				"isFifo": is_fifo,
				"valuationMethod": valuation_method,
				"branches": [_clean_branch(b) for b in branches],
			}
		)
	return items


# --------------------------------------------------------------------------- #
# Whitelisted API
# --------------------------------------------------------------------------- #

@frappe.whitelist()
def get_dn_traceability(delivery_note=None, delivery_notes=None, limit=None, company=None):
	"""Main entry point used by the page.

	A Delivery Note, Sales Order, or AO Number selection is now MANDATORY —
	call this with exactly one of:
	- delivery_note: trace just that one Delivery Note.
	- delivery_notes: JSON-encoded list of Delivery Notes to trace together
	  (e.g. every DN under a chosen AO Number / Sales Order). Still capped by
	  `limit` as a safety guard.

	Calling this with neither is rejected — there is no longer a "most
	recent Delivery Notes" fallback; `company` is only ever a secondary
	narrowing filter, never enough on its own to run a trace.

	Computed live from SLE on every call — nothing is cached or stored.
	"""
	limit = frappe.utils.cint(limit) or DEFAULT_FETCH_LIMIT
	limited = False

	if delivery_note:
		frappe.has_permission("Delivery Note", doc=delivery_note, throw=True)
		dn_list = [delivery_note]

	elif delivery_notes:
		if isinstance(delivery_notes, str):
			delivery_notes = frappe.parse_json(delivery_notes)
		delivery_notes = [d for d in (delivery_notes or []) if d]
		limited = len(delivery_notes) > limit
		dn_list = delivery_notes[:limit]
		for dn_name in dn_list:
			frappe.has_permission("Delivery Note", doc=dn_name, throw=True)

	else:
		# No Delivery Note / AO Number / Sales Order scope given — this is no
		# longer allowed. Selection of at least one of the three is required.
		frappe.throw(
			frappe._(
				"Please select an AO Number, Sales Order, or Delivery Note before "
				"fetching stock traceability."
			),
			title=frappe._("Selection Required"),
		)

	items = []
	for dn_name in dn_list:
		items.extend(_trace_one_dn(dn_name))

	return {
		"delivery_notes": dn_list,
		"items": items,
		"limited": limited,  # True => more DNs exist for this scope than were fetched
		"limit": limit,
	}


@frappe.whitelist()
def get_dn_items_for_sales_order(sales_order):
	"""Helper for the Sales Order -> Delivery Note dropdown linkage (manual
	Sales Order selection, independent of the AO Number field)."""
	return frappe.db.get_all(
		"Delivery Note Item",
		filters={"against_sales_order": sales_order, "docstatus": 1},
		pluck="parent",
		distinct=True,
	)


@frappe.whitelist()
def get_so_links(sales_order):
	"""Reverse lookup used when a Sales Order is picked directly (not via the
	AO Number field): resolves the AO Number (Project) and the Delivery
	Notes linked to that Sales Order, so picking a Sales Order can auto-fill
	the AO Number field too (bidirectional AO <-> Sales Order auto-set).
	ASSUMPTION: Sales Order has a "project" field — same assumption as
	get_links_from_ao()."""
	if not sales_order or not frappe.db.exists("Sales Order", sales_order):
		return {}
	project = frappe.db.get_value("Sales Order", sales_order, "project")
	delivery_notes = get_dn_items_for_sales_order(sales_order)
	return {"project": project, "delivery_notes": delivery_notes}


def _delivery_notes_for_project(project):
	"""Submitted Delivery Notes whose Delivery Note Item.project matches the
	given AO (Project). project lives on the DN's child table, so this needs
	a join rather than a plain frappe.db.get_all filter."""
	rows = frappe.db.sql(
		"""
		select distinct dn.name
		from `tabDelivery Note Item` dni
		inner join `tabDelivery Note` dn on dn.name = dni.parent
		where dni.project = %(project)s
		  and dn.docstatus = 1
		order by dn.posting_date desc, dn.posting_time desc
		""",
		{"project": project},
		as_dict=True,
	)
	return [r.name for r in rows]


@frappe.whitelist()
def get_links_from_ao(project):
	"""AO Number lookup.

	- Sales Orders are matched via Sales Order.project = <AO>.
	- Delivery Notes are matched via Delivery Note Item.project = <AO>.

	ASSUMPTION: Sales Order has a "project" field, and Delivery Note Item has
	a "project" field. Adjust the two queries below if your Assembly Order
	lives on different fields/doctypes.

	Returns {"sales_orders": [...], "delivery_notes": [...]}.
	"""
	if not project or not frappe.db.exists("Project", project):
		return {"sales_orders": [], "delivery_notes": []}

	sales_orders = frappe.db.get_all(
		"Sales Order",
		filters={"project": project, "docstatus": 1},
		pluck="name",
		order_by="transaction_date desc",
	)
	delivery_notes = _delivery_notes_for_project(project)

	return {"sales_orders": sales_orders, "delivery_notes": delivery_notes}


@frappe.whitelist()
def dn_query_for_project(doctype, txt, searchfield, start, page_len, filters):
	"""Custom Link-field query wired to the Delivery Note filter's
	`get_query` on the client. Restricts the Delivery Note dropdown to
	submitted Delivery Notes whose Delivery Note Item.project matches the
	currently selected AO Number. Runs only when the user opens/searches the
	dropdown — it never triggers a full page fetch, so it can't cause the
	cascading-call problem the AO -> SO -> DN chain used to have."""
	filters = filters or {}
	project = filters.get("project")
	if not project:
		return []

	return frappe.db.sql(
		"""
		select distinct dn.name, dn.posting_date
		from `tabDelivery Note Item` dni
		inner join `tabDelivery Note` dn on dn.name = dni.parent
		where dni.project = %(project)s
		  and dn.docstatus = 1
		  and dn.name like %(txt)s
		order by dn.posting_date desc
		limit %(page_len)s offset %(start)s
		""",
		{
			"project": project,
			"txt": f"%{txt or ''}%",
			"start": frappe.utils.cint(start),
			"page_len": frappe.utils.cint(page_len) or 20,
		},
	)
 
 
@frappe.whitelist()
def dn_multiselect_query(txt=None, project=None, company=None, limit=20):
	"""Powers the Delivery Note MultiSelectList's get_data() on the client.

	- When `project` (AO Number) is set: scoped to submitted Delivery Notes
	  whose Delivery Note Item.project = <AO> (same join as
	  _delivery_notes_for_project(), but with free-text search + limit so it
	  works as a live dropdown).
	- Otherwise: plain "recent submitted Delivery Notes" search, optionally
	  narrowed by `company`.

	Returns a list of {value, description} dicts — the shape
	ControlMultiSelectList expects from a custom get_data query.
	"""
	txt = txt or ""
	limit = frappe.utils.cint(limit) or 20

	if project:
		rows = frappe.db.sql(
			"""
			select distinct dn.name as value, dn.posting_date as description
			from `tabDelivery Note Item` dni
			inner join `tabDelivery Note` dn on dn.name = dni.parent
			where dni.project = %(project)s
			  and dn.docstatus = 1
			  and dn.name like %(txt)s
			order by dn.posting_date desc
			limit %(limit)s
			""",
			{"project": project, "txt": f"%{txt}%", "limit": limit},
			as_dict=True,
		)
	else:
		conditions = ["dn.docstatus = 1", "dn.name like %(txt)s"]
		values = {"txt": f"%{txt}%", "limit": limit}
		if company:
			conditions.append("dn.company = %(company)s")
			values["company"] = company

		rows = frappe.db.sql(
			f"""
			select dn.name as value, dn.posting_date as description
			from `tabDelivery Note` dn
			where {" and ".join(conditions)}
			order by dn.posting_date desc
			limit %(limit)s
			""",
			values,
			as_dict=True,
		)

	return [{"value": r.value, "description": cstr(r.description) if r.description else ""} for r in rows]