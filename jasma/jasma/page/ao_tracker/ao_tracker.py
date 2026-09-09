# Copyright (c) 2026
# For license information, please see license.txt
#
# ---------------------------------------------------------------------------
# AO TRACKER — backend
#
# Core idea: "AO Number" is not a separate doctype. It IS the Project.
# Every document in the flow carries a `project` link field (Journal Entry's
# lives on the child table `Journal Entry Account`). So an AO's full trail =
# "everything with this Project set".
#
# Drop this file at:
#   <app>/<app>/page/ao_tracker/ao_tracker.py
#
# CHANGELOG (this revision):
#   - REMOVED: `determine_severity()` and the project-age-based "Stage"
#     milestone dict are gone from the list payload.
#   - NEW: `determine_priority()` replaces them. Priority is based on how
#     many days remain between the linked Sales Order's Delivery Date and
#     today:
#       > 60 days left   -> Low
#       31-60 days left  -> Medium
#       16-30 days left  -> High
#       1-15 days left   -> Urgent
#       <= 0 days left   -> Overdue
#     If a Delivery Note already exists for the project it's treated as
#     fulfilled and always reported as Low. If there's no Sales Order yet,
#     or the Sales Order has no Delivery Date set, priority is None (the
#     frontend renders a blank cell).
#   - NEW: "pi" (Purchase Invoice) added to LIST_DOC_KEYS so its name +
#     status are returned to the list view beside Purchase Receipt.
#   - FIXED: `determine_pending()` used to return the literal string "—"
#     once every step was complete; it now returns "" so the frontend can
#     render a blank cell instead of a dash placeholder.
#
# --- Everything below this point is unchanged from the previous revision
#     except where noted inline:
#   - Every doc object returned to the client now carries its own `doctype`,
#     so the frontend can build correct links/routes instead of guessing.
#   - Added a `count` per document type so the UI can show the little
#     "how many of these exist" badge from the wireframe's doc grid.
#   - Added 3 doc types that were in the wireframe but missing from
#     DOC_CONFIG (Stock Requisition, QC Report, Non-Conformance). These are
#     marked "queryable: False" automatically if the doctype/field isn't
#     installed on your site, instead of crashing — adjust the mapping once
#     you know your actual schema for these three.
#   - Order items + material consumption are now paired via each Sales
#     Order Item's default BOM (finished good -> its raw materials), instead
#     of being two unrelated flat lists. Falls back cleanly if BOM isn't
#     installed or an item has no BOM.
#   - New `get_doc_summary` endpoint powers a lightweight preview popup when
#     a document card is clicked, instead of jumping straight into the full
#     form.
#   - `get_doc_list` endpoint. When a project has MORE THAN ONE
#     document of a given type (e.g. 2 Sales Invoices), the list view no
#     longer just silently shows the latest one — the frontend shows a
#     "N Sales Invoices" chip, and clicking it calls this endpoint to fetch
#     every document of that type/project so the user can page through them
#     one at a time instead of only ever seeing the newest.
#
# ASSUMPTIONS — check these against your actual client setup:
#   1. `status` is the field Frappe uses to represent state for most
#      doctypes below. If a client uses `workflow_state` instead, change
#      that entry's "status_field".
#   2. Journal Entry has no header-level `project` — read via the
#      `Journal Entry Account` child table (see get_latest_doc).
#   3. RM cost/consumption is read from Stock Ledger Entries / Stock Entry
#      Detail rows tagged with the project. If your stock moves don't carry
#      project consistently, tighten propagation first.
#   4. "Indirect expense" reads Project.total_costing_amount — swap for
#      whatever your real indirect-cost source is.
#   5. FG -> RM pairing uses each Sales Order Item's *default* BOM. If a
#      client doesn't use BOM/Manufacturing, those rows will just show the
#      FG with no components (no crash).
#   6. Stock Requisition / QC Report / Non-Conformance field mappings are
#      best-effort placeholders — confirm doctype + project field name for
#      your site and adjust DOC_CONFIG.
#   7. Priority reads the standard `delivery_date` field on Sales Order
#      (ERPNext keeps this in sync with the earliest/soonest item delivery
#      date). If your site doesn't populate that field, priority will
#      simply come back blank for that project — swap the field name in
#      `determine_priority()` if your schema differs.
# ---------------------------------------------------------------------------

import frappe
from frappe import _
from frappe.utils import flt, today, date_diff, getdate


DOC_ORDER = [
	"quote", "so", "mr", "po", "sco", "scr", "pr", "sr", "qc", "nc",
	"pi", "dn", "si", "pe_in", "pe_out", "je",
]

# Columns shown on the Tab 1 list grid, in this order (per client request):
# MR -> PO -> Subcontracting Order -> Subcontracting Receipt -> Purchase
# Receipt -> Purchase Invoice -> Delivery Note -> Sales Invoice.
LIST_DOC_KEYS = ["mr", "po", "sco", "scr", "pr", "pi", "dn", "si"]

DOC_CONFIG = {
	"quote": {
		"doctype": "Quotation", "label": "Quotation", "short": "QTN",
		"status_field": "status", "amount_field": "grand_total",
		"project_field": None,  # matched via Sales Order — see get_quotation_names_for_project()
	},
	"so": {
		"doctype": "Sales Order", "label": "Sales Order", "short": "SO",
		"status_field": "status", "amount_field": "grand_total", "project_field": "project",
	},
	"mr": {
		"doctype": "Material Request", "label": "Material Request", "short": "MR",
		"status_field": "status", "amount_field": None, "project_field": "project",
	},
	"po": {
		"doctype": "Purchase Order", "label": "Purchase Order", "short": "PO",
		"status_field": "status", "amount_field": "grand_total", "project_field": "project",
	},
	# Subcontracting flow (ERPNext v15+ standard doctypes, replacing the
	# older Stock-Entry-based subcontracting). Confirm these exist on your
	# site if you're on an older ERPNext version.
	"sco": {
		"doctype": "Subcontracting Order", "label": "Subcontracting Order", "short": "SCO",
		"status_field": "status", "amount_field": "grand_total", "project_field": "project",
	},
	"scr": {
		"doctype": "Subcontracting Receipt", "label": "Subcontracting Receipt", "short": "SCR",
		"status_field": "status", "amount_field": "grand_total", "project_field": "project",
	},
	"pr": {
		"doctype": "Purchase Receipt", "label": "Purchase Receipt", "short": "PR",
		"status_field": "status", "amount_field": "grand_total", "project_field": "project",
	},
	# Placeholder mapping — confirm the real doctype/field for "Stock
	# Requisition" on your site (it isn't a stock Frappe doctype). Left as
	# a Stock Entry / Material Transfer filter as a reasonable default.
	"sr": {
		"doctype": "Stock Entry", "label": "Stock Requisition", "short": "SR",
		"status_field": "status", "amount_field": None, "project_field": "project",
		"extra_filters": {"purpose": "Material Transfer"},
	},
	"qc": {
		"doctype": "QC Report", "label": "QC Report", "short": "QC",
		"status_field": "status", "amount_field": None, "project_field": "project",
	},
	"nc": {
		"doctype": "Non - Conformance", "label": "Non-Conformance", "short": "NC",
		"status_field": "status", "amount_field": None, "project_field": "ao_reference_no",
	},
	"pi": {
		"doctype": "Purchase Invoice", "label": "Purchase Invoice", "short": "PI",
		"status_field": "status", "amount_field": "grand_total", "project_field": "project",
	},
	"dn": {
		"doctype": "Delivery Note", "label": "Delivery Note", "short": "DN",
		"status_field": "status", "amount_field": "grand_total", "project_field": "project",
	},
	"si": {
		"doctype": "Sales Invoice", "label": "Sales Invoice", "short": "SI",
		"status_field": "status", "amount_field": "grand_total", "project_field": "project",
	},
	"pe_in": {
		"doctype": "Payment Entry", "label": "Payment Received", "short": "PREC",
		"status_field": "status", "amount_field": "paid_amount", "project_field": "project",
		"extra_filters": {"payment_type": "Receive"},
	},
	"pe_out": {
		"doctype": "Payment Entry", "label": "Payment Paid", "short": "PPD",
		"status_field": "status", "amount_field": "paid_amount", "project_field": "project",
		"extra_filters": {"payment_type": "Pay"},
	},
	"je": {
		"doctype": "Journal Entry", "label": "Journal Entry", "short": "JE",
		"status_field": None, "amount_field": "total_debit", "project_field": None,
	},
}

# Statuses that count as "still needs action" for pending-stage detection
PENDING_STATUSES = {"Draft", "Pending Approval", "To Approve", "Pending"}

_DOCTYPE_EXISTS_CACHE = {}
_FIELD_EXISTS_CACHE = {}


# ---------------------------------------------------------------------------
# Defensive helpers — so a site missing a doctype/field never 500s the page
# ---------------------------------------------------------------------------

def doctype_installed(doctype):
	if doctype not in _DOCTYPE_EXISTS_CACHE:
		_DOCTYPE_EXISTS_CACHE[doctype] = bool(frappe.db.exists("DocType", doctype))
	return _DOCTYPE_EXISTS_CACHE[doctype]


def field_exists(doctype, fieldname):
	if not fieldname:
		return False
	key = (doctype, fieldname)
	if key not in _FIELD_EXISTS_CACHE:
		try:
			_FIELD_EXISTS_CACHE[key] = frappe.get_meta(doctype).has_field(fieldname)
		except Exception:
			_FIELD_EXISTS_CACHE[key] = False
	return _FIELD_EXISTS_CACHE[key]


# ---------------------------------------------------------------------------
# List view (Tab 1 — Status Overview)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_ao_list(from_date=None, to_date=None, project=None, sales_order=None, limit=200):
	filters = {}
	if from_date and to_date:
		filters["creation"] = ["between", [from_date, to_date]]
	if project:
		filters["name"] = ["like", "%{0}%".format(project)]

	# NEW: Customer no longer comes from Project.customer — it's read from
	# the linked Sales Order instead (Project.customer can be blank/stale
	# even once a Sales Order with its own customer exists).
	projects = frappe.get_all(
		"Project",
		filters=filters,
		fields=["name", "project_name", "creation", "status"],
		order_by="creation desc",
		limit_page_length=frappe.utils.cint(limit) or 200,
	)

	if sales_order:
		matching = set(frappe.get_all(
			"Sales Order",
			filters={"project": ["is", "set"], "name": ["like", "%{0}%".format(sales_order)]},
			pluck="project",
		))
		projects = [p for p in projects if p.name in matching]

	result = []
	for p in projects:
		docs = get_docs_for_project(p.name)
		so_doc = docs.get("so")
		# NEW: pull the customer straight off the linked Sales Order,
		# rather than the Project doctype's own (often stale/blank)
		# customer field.
		customer = None
		if so_doc:
			customer = frappe.db.get_value("Sales Order", so_doc["name"], "customer")
		pending_at, _stage_key = determine_pending(docs)
		priority = determine_priority(docs)
		result.append({
			"project": p.name,
			"project_name": p.project_name,
			"so": so_doc["name"] if so_doc else None,
			"customer": customer,
			"date": str(getdate(p.creation)) if p.creation else None,
			"pending_at": pending_at,
			"priority": priority,
			# Full procurement trail shown on the list grid — each doc
			# carries its own `doctype` so the frontend can route to the
			# right form without guessing.
			"docs": {k: docs.get(k) for k in LIST_DOC_KEYS},
		})
	return result


def determine_pending(docs):
	so = docs.get("so")
	if not so:
		return "Sales Order", "so"
	if so.get("status") in PENDING_STATUSES:
		return "Sales Order approval", "so"

	mr = docs.get("mr")
	if not mr:
		return "Material Request creation", "mr"
	if mr.get("status") in PENDING_STATUSES:
		return "Material Request approval", "mr"

	# A project may go through a regular Purchase Order or a Subcontracting
	# Order (or both) — either counts as "procurement started".
	po = docs.get("po")
	sco = docs.get("sco")
	if not po and not sco:
		return "Purchase Order / Subcontracting Order creation", "po"
	if (po and po.get("status") in PENDING_STATUSES) and not (sco and sco.get("status") not in PENDING_STATUSES):
		return "Purchase Order approval", "po"
	if (sco and sco.get("status") in PENDING_STATUSES) and not (po and po.get("status") not in PENDING_STATUSES):
		return "Subcontracting Order approval", "sco"

	# Likewise, goods can land via a Purchase Receipt or a Subcontracting
	# Receipt.
	pr = docs.get("pr")
	scr = docs.get("scr")
	if not pr and not scr:
		return "Purchase Receipt / Subcontracting Receipt", "pr"

	dn = docs.get("dn")
	if not dn:
		return "Delivery Note", "dn"

	si = docs.get("si")
	if not si:
		return "Sales Invoice", "si"

	# FIX: blank instead of the literal "—" placeholder, so the frontend
	# renders an empty cell rather than a dash.
	return "", None

def determine_priority(docs):
	"""Priority = urgency of the still-pending delivery, based on how many
	days are left between the linked Sales Order's Delivery Date and today.

	  Closed SO         -> "Closed" (shown as-is, not folded into Low —
	                        a closed order isn't necessarily fully delivered)
	  Completed SO / or
	  fully delivered    -> Low
	  > 60 days left     -> Low
	  31-60 days left    -> Medium
	  16-30 days left    -> High
	  1-15 days left     -> Urgent
	  <= 0 days left      -> Overdue (label includes day count, e.g.
	                        "Overdue (5d)")
	"""
	so = docs.get("so")
	if not so:
		return None

	so_info = frappe.db.get_value(
		"Sales Order", so.get("name"),
		["delivery_date", "per_delivered", "status"],
		as_dict=True,
	) or {}

	status = so_info.get("status")

	# Closed is reported as its own label — it does NOT necessarily mean
	# the order was fully delivered, so it must not be silently folded
	# into "Low".
	if status == "Closed":
		return "Closed"

	if flt(so_info.get("per_delivered")) >= 100 or status == "Completed":
		return "Low"

	delivery_date = so_info.get("delivery_date")
	if not delivery_date:
		return None

	diff = date_diff(delivery_date, today())
	if diff > 60:
		return "Low"
	if diff > 30:
		return "Medium"
	if diff > 15:
		return "High"
	if diff >= 1:
		return "Urgent"

	return "Overdue ({0}d)".format(abs(diff))

# ---------------------------------------------------------------------------
# Detail view (Tab 2 — Detailed View)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_ao_detail(project):
	p = frappe.get_doc("Project", project)
	docs = get_docs_for_project(project)

	return {
		"project": p.name,
		"project_name": p.project_name,
		"customer": p.customer,
		"date": str(getdate(p.creation)) if p.creation else None,
		"status": p.status,
		"overview": compute_overview(project),
		"items": get_items_and_consumption(project),
		"docs": docs,
		"doc_meta": {
			k: {
				"label": cfg["label"],
				"short": cfg["short"],
				"doctype": cfg["doctype"],
				"queryable": is_doc_type_queryable(cfg, k),
			}
			for k, cfg in DOC_CONFIG.items()
		},
		"doc_order": DOC_ORDER,
	}


def is_doc_type_queryable(cfg, key=None):
	if not doctype_installed(cfg["doctype"]):
		return False
	if cfg["doctype"] == "Journal Entry":
		return doctype_installed("Journal Entry Account") and field_exists("Journal Entry Account", "project")
	if key == "quote":
		return (
			doctype_installed("Sales Order")
			and doctype_installed("Sales Order Item")
			and field_exists("Sales Order Item", "prevdoc_docname")
		)
	if cfg.get("project_field"):
		return field_exists(cfg["doctype"], cfg["project_field"])
	return False


def resolve_status_field(doctype, cfg):
	"""Never trust that DOC_CONFIG's status_field actually exists on this
	site's version of the doctype — some sites rename/remove it, or drive
	state off `workflow_state` instead. Returns an actual, safe column name
	to select, or None if nothing usable is found (caller selects '' then)."""
	candidate = cfg.get("status_field")
	if candidate and field_exists(doctype, candidate):
		return candidate
	if field_exists(doctype, "workflow_state"):
		return "workflow_state"
	if candidate != "status" and field_exists(doctype, "status"):
		return "status"
	return None


def get_quotation_names_for_project(project):
	"""Quotation carries no direct project link — it only picks up a
	project once it's converted into a Sales Order. A Quotation is
	treated as belonging to this project if it's the source quotation of
	a Sales Order that has this project set, matched via Sales Order
	Item.prevdoc_docname (the standard field Frappe stamps when a Sales
	Order is created from a Quotation)."""
	so_names = frappe.get_all(
		"Sales Order",
		filters={"project": project, "docstatus": ["!=", 2]},
		pluck="name",
	)
	if not so_names:
		return []
	quotation_names = frappe.get_all(
		"Sales Order Item",
		filters={"parent": ["in", so_names], "prevdoc_docname": ["is", "set"]},
		pluck="prevdoc_docname",
	)
	return list(set(quotation_names))


def get_docs_for_project(project):
	return {key: get_latest_doc(project, key, cfg) for key, cfg in DOC_CONFIG.items()}


def get_latest_doc(project, key, cfg):
	doctype = cfg["doctype"]
	if not is_doc_type_queryable(cfg, key):
		return None

	filters = None
	if key == "quote":
		quotation_names = get_quotation_names_for_project(project)
		if not quotation_names:
			return None
		filters = {"name": ["in", quotation_names], "docstatus": ["!=", 2]}
	elif cfg.get("project_field"):
		filters = {cfg["project_field"]: project, "docstatus": ["!=", 2]}
		filters.update(cfg.get("extra_filters") or {})

	if filters is not None:
		fields = ["name", "creation"]

		status_field = resolve_status_field(doctype, cfg)
		if status_field:
			fields.append("{0} as status".format(status_field))

		if cfg.get("amount_field") and field_exists(doctype, cfg["amount_field"]):
			fields.append("{0} as amount".format(cfg["amount_field"]))

		count = frappe.db.count(doctype, filters=filters)
		if not count:
			return None

		rows = frappe.get_all(doctype, filters=filters, fields=fields, order_by="creation desc", limit_page_length=1)
		doc = rows[0]
		if not status_field:
			doc["status"] = None
		doc["doctype"] = doctype
		doc["count"] = count
		return doc

	if doctype == "Journal Entry":
		count_row = frappe.db.sql(
			"""
			select count(distinct je.name)
			from `tabJournal Entry` je
			inner join `tabJournal Entry Account` jea on jea.parent = je.name
			where jea.project = %s and je.docstatus != 2
			""",
			project,
		)
		count = count_row[0][0] if count_row else 0
		if not count:
			return None

		rows = frappe.db.sql(
			"""
			select je.name, je.docstatus, je.creation, je.total_debit as amount
			from `tabJournal Entry` je
			inner join `tabJournal Entry Account` jea on jea.parent = je.name
			where jea.project = %s and je.docstatus != 2
			order by je.creation desc
			limit 1
			""",
			project,
			as_dict=True,
		)
		doc = rows[0]
		doc["status"] = "Submitted" if doc["docstatus"] == 1 else "Draft"
		doc["doctype"] = "Journal Entry"
		doc["count"] = count
		return doc

	return None
# ---------------------------------------------------------------------------
# Full document list for a given key/project — powers the "N Sales
# Invoices" / "N Work Orders" style chip. get_latest_doc() (above) only
# ever returns the single newest row plus a count; this returns every row
# so the frontend can let the user page through them one by one instead of
# only ever seeing the newest document.
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_doc_list(project, key):
	cfg = DOC_CONFIG.get(key)
	if not cfg:
		frappe.throw(_("Unknown document key: {0}").format(key))

	doctype = cfg["doctype"]
	if not is_doc_type_queryable(cfg, key):
		return []

	filters = None
	if key == "quote":
		quotation_names = get_quotation_names_for_project(project)
		if not quotation_names:
			return []
		filters = {"name": ["in", quotation_names], "docstatus": ["!=", 2]}
	elif cfg.get("project_field"):
		filters = {cfg["project_field"]: project, "docstatus": ["!=", 2]}
		filters.update(cfg.get("extra_filters") or {})

	if filters is not None:
		fields = ["name", "creation"]

		status_field = resolve_status_field(doctype, cfg)
		if status_field:
			fields.append("{0} as status".format(status_field))

		if cfg.get("amount_field") and field_exists(doctype, cfg["amount_field"]):
			fields.append("{0} as amount".format(cfg["amount_field"]))

		rows = frappe.get_all(
			doctype, filters=filters, fields=fields, order_by="creation desc"
		)
		for r in rows:
			r["doctype"] = doctype
			if not status_field:
				r["status"] = None
		return rows

	if doctype == "Journal Entry":
		rows = frappe.db.sql(
			"""
			select distinct je.name, je.docstatus, je.creation, je.total_debit as amount
			from `tabJournal Entry` je
			inner join `tabJournal Entry Account` jea on jea.parent = je.name
			where jea.project = %s and je.docstatus != 2
			order by je.creation desc
			""",
			project,
			as_dict=True,
		)
		for r in rows:
			r["status"] = "Submitted" if r["docstatus"] == 1 else "Draft"
			r["doctype"] = "Journal Entry"
		return rows

	return []

def compute_overview(project):
	# Est. Revenue = Sales Invoice net_value, falling back to Sales Order
	# net_total if no Sales Invoice exists yet.
	revenue = flt(frappe.db.sql(
		"""
		select sum(net_total) from `tabSales Invoice`
		where project = %s and docstatus = 1
		""",
		project,
	)[0][0] or 0)
	if not revenue:
		revenue = flt(frappe.db.sql(
			"""
			select sum(net_total) from `tabSales Order`
			where project = %s and docstatus = 1
			""",
			project,
		)[0][0] or 0)

	# FIXED: Total RM Cost was previously pulling every Delivery Note whose
	# own `project` field matched — but a DN's project can be blank/wrong
	# even when it's genuinely the one that fulfilled this project's Sales
	# Invoice. Correct source of truth: walk from this project's Sales
	# Invoice(s) -> Sales Invoice Item.delivery_note (the actual DN each
	# invoiced row was billed against) -> GL Entries posted for those
	# specific Delivery Notes.
	dn_names = frappe.db.sql(
		"""
		select distinct sii.delivery_note
		from `tabSales Invoice Item` sii
		inner join `tabSales Invoice` si on si.name = sii.parent
		where si.project = %s and si.docstatus = 1
			and sii.delivery_note is not null and sii.delivery_note != ''
		""",
		project,
		pluck=True,
	)

	rm_cost = 0.0
	if dn_names:
		rm_cost = flt(frappe.db.sql(
			"""
			select sum(debit_in_account_currency)
			from `tabGL Entry`
			where voucher_type = 'Delivery Note'
				and voucher_no in %s
			""",
			(dn_names,),
		)[0][0] or 0)

	# Total Indirect Expense = Purchase Invoice net_value, this project's
	# Purchase Invoices only, non-stock items only, "Is Subcontracted"
	# unchecked.
	has_is_subcontracted = field_exists("Purchase Invoice", "is_subcontracted")
	subcontract_clause = "and pi.is_subcontracted = 0" if has_is_subcontracted else ""
	indirect = flt(frappe.db.sql(
		"""
		select sum(pii.net_amount)
		from `tabPurchase Invoice Item` pii
		inner join `tabPurchase Invoice` pi on pi.name = pii.parent
		inner join `tabItem` it on it.name = pii.item_code
		where pi.project = %s and pi.docstatus = 1
			and it.is_stock_item = 0
			{subcontract_clause}
		""".format(subcontract_clause=subcontract_clause),
		project,
	)[0][0] or 0)

	profit = revenue - rm_cost - indirect
	profit_pct = (profit / revenue * 100) if revenue else 0

	return {
		"revenue": revenue,
		"rm_cost": rm_cost,
		"indirect": indirect,
		"profit": profit,
		"profit_pct": profit_pct,
	}


def get_items_and_consumption(project):
	"""Returns Sales Order items paired with their BOM raw materials, plus
	the flat lists kept for backward compatibility with older callers."""

	order_items = frappe.db.sql(
		"""
		select soi.item_code, soi.item_name, soi.qty, soi.delivered_qty, soi.rate, soi.parent as sales_order
		from `tabSales Order Item` soi
		inner join `tabSales Order` so on so.name = soi.parent
		where so.project = %s and so.docstatus = 1
		order by soi.idx
		""",
		project,
		as_dict=True,
	)

	consumption_map = {
		r.item_code: r
		for r in frappe.db.sql(
			"""
			select sed.item_code, sum(sed.qty) as qty_consumed, avg(sed.valuation_rate) as valuation_rate
			from `tabStock Entry Detail` sed
			inner join `tabStock Entry` se on se.name = sed.parent
			where se.project = %s and se.docstatus = 1
				and se.purpose in ('Material Issue', 'Manufacture', 'Material Transfer for Manufacture')
			group by sed.item_code
			""",
			project,
			as_dict=True,
		)
	}

	ordered_map = {}
	if doctype_installed("Purchase Order") and field_exists("Purchase Order", "project"):
		ordered_map = {
			r.item_code: r.total_ordered
			for r in frappe.db.sql(
				"""
				select poi.item_code, sum(poi.qty) as total_ordered
				from `tabPurchase Order Item` poi
				inner join `tabPurchase Order` po on po.name = poi.parent
				where po.project = %s and po.docstatus = 1
				group by poi.item_code
				""",
				project,
				as_dict=True,
			)
		}

	bom_available = doctype_installed("BOM") and doctype_installed("BOM Item")

	rows = []
	flat_consumption = []

	for it in order_items:
		components = []
		if bom_available:
			bom_name = frappe.db.get_value(
				"BOM", {"item": it.item_code, "is_default": 1, "docstatus": 1}, "name"
			)
			if bom_name:
				components = frappe.db.sql(
					"""
					select bi.item_code, bi.item_name, bi.qty as qty_per_unit
					from `tabBOM Item` bi
					where bi.parent = %s
					order by bi.idx
					""",
					bom_name,
					as_dict=True,
				)

		if not components:
			# No BOM found for this item — still show the finished good on
			# its own row rather than silently dropping it.
			rows.append({
				"order_item": it.item_name or it.item_code,
				"item_code": it.item_code,
				"type": "FG",
				"component_name": None,
				"component_code": None,
				"qty_needed": it.qty,
				"total_ordered": None,
				"consumed": None,
				"fg_delivered": it.delivered_qty,
				"selling_price": it.rate,
				"valuation_rate": None,
				"group_start": True,
			})
			continue

		for i, comp in enumerate(components):
			cons = consumption_map.get(comp.item_code)
			valuation_rate = (cons.valuation_rate if cons else None)
			if valuation_rate is None:
				valuation_rate = frappe.db.get_value("Item", comp.item_code, "valuation_rate")

			rows.append({
				"order_item": (it.item_name or it.item_code) if i == 0 else None,
				"item_code": it.item_code if i == 0 else None,
				"type": "FG" if i == 0 else "RM",
				"component_name": comp.item_name or comp.item_code,
				"component_code": comp.item_code,
				"qty_needed": flt(comp.qty_per_unit) * flt(it.qty),
				"total_ordered": ordered_map.get(comp.item_code),
				"consumed": cons.qty_consumed if cons else None,
				"fg_delivered": it.delivered_qty if i == 0 else None,
				"selling_price": it.rate if i == 0 else None,
				"valuation_rate": valuation_rate,
				"group_start": i == 0,
			})
			flat_consumption.append({
				"item_code": comp.item_code,
				"item_name": comp.item_name,
				"qty_consumed": cons.qty_consumed if cons else 0,
				"valuation_rate": cons.valuation_rate if cons else 0,
			})

	return {
		"order_items": order_items,
		"rows": rows,
		"material_consumption": flat_consumption,
	}


# ---------------------------------------------------------------------------
# Document preview (powers the "click a doc card" popup instead of jumping
# straight to the full form)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_doc_summary(doctype, name):
	if not frappe.db.exists(doctype, name):
		frappe.throw(_("{0} {1} not found").format(doctype, name))

	doc = frappe.get_doc(doctype, name)

	project = doc.get("project") if doc.meta.has_field("project") else None
	if not project and doctype == "Journal Entry":
		row = frappe.db.sql(
			"select project from `tabJournal Entry Account` where parent=%s and project is not null limit 1",
			name,
		)
		project = row[0][0] if row else None

	child_fieldname = None
	for df in doc.meta.get_table_fields():
		if df.fieldname == "items":
			child_fieldname = df.fieldname
			break

	items = []
	if child_fieldname:
		for row in doc.get(child_fieldname):
			reference = None
			for ref_field, ref_doctype in (
				("against_sales_order", "Sales Order"),
				("sales_order", "Sales Order"),
				("material_request", "Material Request"),
			):
				if row.get(ref_field):
					reference = {"doctype": ref_doctype, "name": row.get(ref_field)}
					break
			items.append({
				"item_code": row.get("item_code"),
				"item_name": row.get("item_name") or row.get("item_code"),
				"qty": flt(row.get("qty")),
				"uom": row.get("uom") or row.get("stock_uom"),
				"reference": reference,
			})

	status_field = None
	if doc.meta.has_field("status"):
		status_field = "status"
	elif doc.meta.has_field("workflow_state"):
		status_field = "workflow_state"

	return {
		"doctype": doctype,
		"name": doc.name,
		"status": doc.get(status_field) if status_field else None,
		"project": project,
		"items": items,
		"total_qty": sum(i["qty"] for i in items),
	}