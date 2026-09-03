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
#
# NOTE ON UNTRACED-QUANTITY DIAGNOSTICS:
#   Previously, any shortfall in the backward scan was labelled generically
#   as "Opening Stock, stock reconciliation, or negative stock" — even when
#   an inward Stock Ledger Entry for that exact item/warehouse DID exist
#   somewhere (just too late, or in a different warehouse). That was
#   misleading: the UI would show "0% traced / Opening Stock" for an item
#   that actually has a perfectly good source document, just one that
#   couldn't be used for THIS particular delivery's timing/location.
#
#   _diagnose_shortfall() runs whenever a shortfall can't be covered by the
#   bounded backward scan (and, as of this revision, also can't be covered
#   by the cross-warehouse fallback below), and distinguishes three cases:
#     1. An inward SLE for this item+warehouse exists, but it's dated AFTER
#        the delivery being traced (so it legitimately can't be the source
#        — most likely a data-entry / posting-date issue worth reviewing).
#     2. An inward SLE for this item exists, but in a DIFFERENT warehouse
#        (likely a missing/broken Material Transfer leg into the warehouse
#        the delivery actually shipped from).
#     3. Neither — genuine opening stock / stock reconciliation / negative
#        stock, nothing to find anywhere.
#   Every case now also carries the resolved Item name, and — for cases 1
#   and 2 — the specific voucher (type + name) and SLE name that IS out
#   there, so the frontend can render a clickable link straight to it
#   instead of a dead end.
#
# NOTE ON THE "Case 0" SAME-WAREHOUSE EXCLUSION CHECK (this revision):
#   A real case surfaced where an inward SLE existed for the EXACT same
#   item_code + warehouse as the delivery, strictly before the delivery
#   date (e.g. a Subcontracting Receipt posting 500 units into the same
#   warehouse a Delivery Note later shipped 500 units from) — and the
#   trace STILL reported it as untraced "Opening Stock". That is not a
#   cross-warehouse problem (a same-warehouse, same-item match should
#   always be found by stage1_backward_scan's own query), so an earlier
#   "cross-warehouse fallback" fix here was reverted — it was solving a
#   different, hypothetical scenario and did nothing for this actual bug.
#
#   _diagnose_shortfall() now runs a "Case 0" check FIRST: it re-queries the
#   exact same item_code + warehouse, before the same date, with NO
#   actual_qty/is_cancelled filter. If a row comes back:
#     - and it fails actual_qty > 0 or is_cancelled = 0, the note says so
#       explicitly — that pinpoints a data problem on that specific SLE
#       (e.g. it's an outward move, or it's a cancelled entry) as the real
#       cause, not a genuine untraced quantity.
#     - and it looks otherwise valid (passes both filters), the note flags
#       that stage1_backward_scan's own query SHOULD have matched it and
#       didn't — meaning the mismatch is happening in the SQL comparison
#       itself (most likely the warehouse value or the before-datetime
#       cast), which needs investigating directly rather than guessed at
#       here. Either way, this is surfaced distinctly from genuine Case 1 /
#       Case 2 / Case 3 diagnoses so it's never confused with real opening
#       stock or a real cross-warehouse gap.
#
# NOTE ON SUBCONTRACTING RM METADATA (this revision):
#   resolve_subcontracting_receipt() attaches a `meta` block to the
#   "Raw Material Consumed" node it builds for each Subcontracting Receipt
#   Supplied Item row: the source SLE name, the RM item code, the RM qty
#   actually consumed, and the equivalent finished-good qty it covers.
#   Per updated requirements:
#     - The node's own headline Qty (n.qty, e.g. "Qty: 3150.0") now shows
#       the ACTUAL RM QTY CONSUMED — the same number as "RM Qty Consumed"
#       in the meta panel below it — instead of a finished-good-equivalent
#       number that could drift out of sync when a lot got traced across
#       multiple downstream source documents (this used to show a
#       leftover/partial number like 532.57 instead of the real 9450).
#     - The meta panel's "RM Item" line now shows just the Item Code (no
#       Item Name) — the frontend renders it as a plain, non-clickable
#       label per updated requirements.
#     - The "Ref" (Subcontracting Receipt Item reference row) line has
#       been removed entirely — it added no value to the reader.

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
	"""Scan inward SLEs (actual_qty > 0) for item+warehouse, going backward from
	before_datetime, accumulating lots until `target_qty` is covered. Bounded:
	stops as soon as covered >= target_qty (never reads full history).

	Returns (lots, covered) where lots is newest-first:
	[{sle, qty, rate, voucher_type, voucher_no, posting_datetime}, ...]
	"""
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
			break  # bounded scan — stop early, matches Section 4 / Section 8 pseudocode
		take = min(flt(r.actual_qty), remaining_needed)
		lots.append(
			{
				"sle": r.name,
				"warehouse": warehouse,
				"qty": take,
				"rate": r.incoming_rate,
				"voucher_type": r.voucher_type,
				"voucher_no": r.voucher_no,
				"posting_datetime": r.posting_datetime,
			}
		)
		covered += take
	return lots, covered


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
# Untraced-shortfall diagnostics (see module docstring note above)
# --------------------------------------------------------------------------- #

def _diagnose_shortfall(item_code, warehouse, before_datetime):
	"""When the backward scan can't cover the needed qty, work out WHY
	instead of just labelling it "Opening Stock". Read-only — never changes
	what's traced, only what's reported for the untraced remainder.

	Returns a dict:
	{item_name, hint_entry, hint_entry_type, hint_sle, note, short}
	`short` is True whenever the underlying entry is a Stock Reconciliation
	(the standard way Opening Stock is recorded) or when no entry was found
	anywhere — in both cases the frontend renders a minimal two-line note
	("Opening Stock / Stock Reconciliation Entry" + item code) instead of
	the full diagnostic paragraph, since there's nothing actionable to
	investigate in either scenario.
	"""
	item_name = frappe.db.get_value("Item", item_code, "item_name") or item_code

	def _short(hint_entry=None, hint_entry_type=None, hint_sle=None):
		return {
			"item_name": item_name,
			"hint_entry": hint_entry,
			"hint_entry_type": hint_entry_type,
			"hint_sle": hint_sle,
			"note": "Opening Stock / Stock Reconciliation Entry",
			"short": True,
		}

	# Case 0: an inward SLE for this EXACT item + warehouse, before this
	# date, DOES exist — but stage1_backward_scan() still didn't pick it up
	# as a source (excluded by actual_qty<=0 / is_cancelled, or a query-
	# level mismatch). Kept as the FULL diagnostic UNLESS the entry itself
	# is a Stock Reconciliation — that's Opening Stock by definition, so it
	# gets the short note instead.
	exact_row = frappe.db.sql(
		"""
		select name, actual_qty, is_cancelled, voucher_type, voucher_no,
		       timestamp(posting_date, posting_time) as posting_datetime
		from `tabStock Ledger Entry`
		where item_code = %(item_code)s and warehouse = %(warehouse)s
		  and timestamp(posting_date, posting_time) < %(before)s
		order by posting_date desc, posting_time desc
		limit 1
		""",
		{"item_code": item_code, "warehouse": warehouse, "before": before_datetime},
		as_dict=True,
	)
	if exact_row:
		e = exact_row[0]
		if e.voucher_type == "Stock Reconciliation":
			return _short(e.voucher_no, e.voucher_type, e.name)

		reasons = []
		if flt(e.actual_qty) <= 0:
			reasons.append(f"actual_qty is {e.actual_qty} (not > 0, so it isn't an inward entry)")
		if e.is_cancelled:
			reasons.append("is_cancelled = 1 on this entry")
		if reasons:
			return {
				"item_name": item_name,
				"hint_entry": e.voucher_no,
				"hint_entry_type": e.voucher_type,
				"hint_sle": e.name,
				"note": (
					f"An SLE for {item_name} ({item_code}) in {warehouse} before this date "
					f"DOES exist — {e.voucher_type} {e.voucher_no} ({e.name}) — but it was "
					f"excluded from tracing because: {'; '.join(reasons)}. This is a data "
					f"issue on that specific entry, not a genuine untraced quantity — "
					f"check it directly."
				),
				"short": False,
			}
		return {
			"item_name": item_name,
			"hint_entry": e.voucher_no,
			"hint_entry_type": e.voucher_type,
			"hint_sle": e.name,
			"note": (
				f"An SLE for {item_name} ({item_code}) in {warehouse} before this date "
				f"DOES exist and looks valid ({e.voucher_type} {e.voucher_no}, {e.name}), "
				f"but the backward scan still didn't pick it up. This points to a query- "
				f"level mismatch (e.g. warehouse value formatting, or the before-datetime "
				f"comparison) rather than a real untraced quantity — please report this "
				f"exact case for investigation."
			),
			"short": False,
		}

	# Case 1: an inward SLE for this exact item+warehouse exists, but it's
	# dated AFTER this delivery. Short-circuited to the short note if it's
	# a Stock Reconciliation entry too.
	future_row = frappe.db.sql(
		"""
		select name, voucher_type, voucher_no,
		       timestamp(posting_date, posting_time) as posting_datetime
		from `tabStock Ledger Entry`
		where item_code = %(item_code)s and warehouse = %(warehouse)s
		  and actual_qty > 0 and is_cancelled = 0
		  and timestamp(posting_date, posting_time) >= %(before)s
		order by posting_date asc, posting_time asc
		limit 1
		""",
		{"item_code": item_code, "warehouse": warehouse, "before": before_datetime},
		as_dict=True,
	)
	if future_row:
		f = future_row[0]
		if f.voucher_type == "Stock Reconciliation":
			return _short(f.voucher_no, f.voucher_type, f.name)
		return {
			"item_name": item_name,
			"hint_entry": f.voucher_no,
			"hint_entry_type": f.voucher_type,
			"hint_sle": f.name,
			"note": (
				f"No inward stock found before this date for {item_name} ({item_code}) in "
				f"{warehouse}. Nearest inward entry is {f.voucher_type} {f.voucher_no} "
				f"({f.posting_datetime}) — but it's dated AFTER this delivery, so it can't "
				f"be the source. Check the posting dates."
			),
			"short": False,
		}

	# Case 2: an inward SLE for this item exists, but in a DIFFERENT
	# warehouse before this date. Same Stock Reconciliation short-circuit.
	other_wh_row = frappe.db.sql(
		"""
		select name, warehouse, voucher_type, voucher_no,
		       timestamp(posting_date, posting_time) as posting_datetime
		from `tabStock Ledger Entry`
		where item_code = %(item_code)s and warehouse != %(warehouse)s
		  and actual_qty > 0 and is_cancelled = 0
		  and timestamp(posting_date, posting_time) < %(before)s
		order by posting_date desc, posting_time desc
		limit 1
		""",
		{"item_code": item_code, "warehouse": warehouse, "before": before_datetime},
		as_dict=True,
	)
	if other_wh_row:
		o = other_wh_row[0]
		if o.voucher_type == "Stock Reconciliation":
			return _short(o.voucher_no, o.voucher_type, o.name)
		return {
			"item_name": item_name,
			"hint_entry": o.voucher_no,
			"hint_entry_type": o.voucher_type,
			"hint_sle": o.name,
			"note": (
				f"No inward stock for {item_name} ({item_code}) in {warehouse} before this "
				f"date. It WAS received into a different warehouse ({o.warehouse}) via "
				f"{o.voucher_type} {o.voucher_no} — likely a missing Material Transfer "
				f"into {warehouse}."
			),
			"short": False,
		}

	# Case 3: genuinely nothing anywhere — this IS opening stock by
	# definition, so it's always the short note.
	return _short()


def _untraced_branch(qty, item_code, warehouse, before_datetime):
	"""Builds one untraced branch dict, populated with the diagnostic hint
	from _diagnose_shortfall()."""
	diag = _diagnose_shortfall(item_code, warehouse, before_datetime)
	return {
		"qty": qty,
		"untraced": True,
		"note": diag["note"],
		"item_name": diag["item_name"],
		"hint_entry": diag["hint_entry"],
		"hint_entry_type": diag["hint_entry_type"],
		"hint_sle": diag["hint_sle"],
		"short": diag.get("short", False),
	}


# --------------------------------------------------------------------------- #
# Stage 2 — Resolve each consumed lot to its source (Section 5)
# --------------------------------------------------------------------------- #

def build_branches(item_code, warehouse, qty, before_datetime, depth=0):
	"""Full recursive trace for `qty` of `item_code` in `warehouse` as of
	before_datetime. Returns a flat list of branch dicts:
	{qty, chain:[{t,title,sub,qty}], src, po, rm?, via?, untraced?, assumed?}
	"""
	if depth > MAX_DEPTH:
		return [{"qty": qty, "untraced": True, "note": "Max trace depth reached"}]

	lots, covered = stage1_backward_scan(item_code, warehouse, qty, before_datetime)
	branches = []
	for lot in lots:
		branches.extend(resolve_lot(lot, item_code, warehouse, depth))

	shortfall = qty - covered
	if shortfall > EPSILON:
		# No earlier inward SLE found in this exact warehouse (opening
		# stock / stock reconciliation / negative stock) — or one exists
		# but couldn't be used (see _diagnose_shortfall() for the exact
		# reason surfaced to the UI, including the Case 0 same-warehouse
		# exclusion check).
		branches.append(_untraced_branch(shortfall, item_code, warehouse, before_datetime))
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


_scr_order_field_cache = {}


def _scr_order_fieldname():
	"""Detects which fieldname(s) actually exist on this site for the
	Subcontracting Order reference — checked on BOTH the parent
	Subcontracting Receipt doctype and the child Subcontracting Receipt
	Item doctype, since different Frappe/ERPNext versions (and different
	subcontracting flows — with vs without an explicit Subcontracting
	Order) put this reference in different places. Cached per-process."""
	if "resolved" not in _scr_order_field_cache:
		parent_meta = frappe.get_meta("Subcontracting Receipt")
		child_meta = frappe.get_meta("Subcontracting Receipt Item")

		parent_field = next(
			(f for f in ("subcontracting_order", "purchase_order") if parent_meta.has_field(f)),
			None,
		)
		child_field = next(
			(f for f in ("subcontracting_order", "purchase_order", "subcontracting_order_item")
			 if child_meta.has_field(f)),
			None,
		)
		_scr_order_field_cache["resolved"] = {"parent": parent_field, "child": child_field}
	return _scr_order_field_cache["resolved"]


def _get_scr_order_no(scr_name, item_code, parent_value):
	"""Resolves the Subcontracting/Purchase Order linked to a specific
	Subcontracting Receipt. Tries, in order:
	  1. The value already fetched off the PARENT doc (if that field
	     exists there and is populated).
	  2. The same fieldname on the CHILD Subcontracting Receipt Item row
	     for this specific item (covers sites/flows where the order
	     reference is only stored per-line, not on the parent).
	Returns None if neither location has a value — meaning this receipt
	genuinely has no linked order, not a lookup bug."""
	if parent_value:
		return parent_value

	fields = _scr_order_fieldname()
	child_field = fields["child"]
	if not child_field:
		return None

	return frappe.db.get_value(
		"Subcontracting Receipt Item",
		{"parent": scr_name, "item_code": item_code},
		child_field,
	)


def resolve_subcontracting_receipt(lot, item_code, warehouse, depth):
	"""Section 5.2 — FG side is terminal (resolve SO/PO); RM side continues
	one level deeper via the supplied_items child table.

	Each RM branch carries a `meta` block on its "Raw Material Consumed"
	node — the source SLE name, RM item code, the RM qty actually consumed,
	and the equivalent finished-good qty it covers — so the frontend can
	render a clickable, self-explanatory node instead of a bare label.

	The Subcontracting Receipt's own order reference (SR -> SO/PO) is now
	rendered as a horizontal SIDE branch on the frontend (n.side), separate
	from the vertical RM chain below it. Confirmed on this site that the
	order reference lives on the CHILD Subcontracting Receipt Item row
	(subcontracting_order / purchase_order) — NOT on the parent
	Subcontracting Receipt doctype at all — so it's fetched per item_code
	from the child table, same pattern as resolve_purchase_receipt() uses
	for Purchase Receipt Item.purchase_order.

	IMPORTANT: the node's own headline Qty (n.qty) is set to the ACTUAL RM
	QTY CONSUMED (`rm_qty`) — the same number shown as "RM Qty Consumed" in
	the meta panel — instead of a finished-good equivalent recomputed per
	downstream branch. That FG-equivalent number used to drift (e.g.
	showing 532.57 instead of the real 9450) whenever a single RM
	consumption got traced across more than one downstream source
	document, because each downstream branch recomputed its own partial
	share. The RM Qty Consumed is a single, fixed fact about this
	Subcontracting Receipt row and is the same for every downstream branch,
	so it's now what both the headline Qty and the meta line show — no
	inconsistency between the two.
	"""
	scr = frappe.db.get_value(
		"Subcontracting Receipt",
		lot["voucher_no"],
		["posting_date", "posting_time", "supplier_warehouse"],
		as_dict=True,
	)

	# The order reference lives on the CHILD Subcontracting Receipt Item
	# row (subcontracting_order), NOT on the parent Subcontracting Receipt
	# doctype — confirmed against this site's actual doctype fields.
	# Falls back to purchase_order on the same child row for the older
	# (pre-Subcontracting-Order) flow, if subcontracting_order is empty.
	scr_item_order = frappe.db.get_value(
		"Subcontracting Receipt Item",
		{"parent": lot["voucher_no"], "item_code": item_code},
		["subcontracting_order", "purchase_order"],
		as_dict=True,
	)

	# Prefer the Purchase Order over the Subcontracting Order when both
	# are populated — the side box should show "SR -> PO", not "SR -> SO",
	# per requirements. so_label tracks which one was actually used so the
	# node title/doctype match the real linked document.
	so_no, so_label = None, None
	if scr_item_order:
		if scr_item_order.purchase_order:
			so_no, so_label = scr_item_order.purchase_order, "Purchase Order"
		elif scr_item_order.subcontracting_order:
			so_no, so_label = scr_item_order.subcontracting_order, "Subcontracting Order"

	scr_node = _node("doc", "Subcontracting Receipt", lot["voucher_no"], lot["qty"])
	if so_no:
		# Rendered as a horizontal side-branch to the RIGHT of the
		# Subcontracting Receipt box (SR -> its own PO) instead of
		# stacked into the vertical chain — this is the SR's OWN order,
		# not the Raw Material's Purchase Order that appears further
		# down the chain (those are two different documents).
		scr_node["side"] = _node("order", so_label, so_no, lot["qty"])
	base_chain = [scr_node]
 
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
			# Headline Qty (n.qty) AND meta.rm_qty_consumed both show the
			# same, fixed RM Qty Consumed figure — see docstring above.
			rm_node = _node("warehouse", "Raw Material Consumed", s.rm_item_code, rm_qty)
			rm_node["meta"] = {
				"sle": lot.get("sle"),
				"rm_item_code": s.rm_item_code,
				"rm_qty_consumed": flt(rm_qty, 4),
				"fg_qty_covered": flt(lot["qty"], 4),
			}

			rb["chain"] = base_chain + [rm_node] + rb.get("chain", [])
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
		# See module docstring note — this now carries the real reason
		# (nearby-but-unusable entry / same-warehouse exclusion / genuine
		# opening stock) instead of a flat "Opening Stock" label.
		branches.append(_untraced_branch(untraced_qty, item_code, warehouse, before_dt))

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