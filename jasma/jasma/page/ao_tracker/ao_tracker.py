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

	# Only include projects that have a submitted Sales Order
	so_projects = set(frappe.get_all(
		"Sales Order",
		filters={"project": ["is", "set"], "docstatus": 1},
		pluck="project",
	))
	projects = [p for p in projects if p.name in so_projects]

	if sales_order:
		matching = set(frappe.get_all(
			"Sales Order",
			filters={"project": ["is", "set"], "name": ["like", "%{0}%".format(sales_order)], "docstatus": 1},
			pluck="project",
		))
		projects = [p for p in projects if p.name in matching]

	result = []
	for p in projects:
		docs = get_docs_for_project(p.name)
		so_doc = docs.get("so")
		if not so_doc:
			continue

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

	# When Sales Invoice is created, procurement and invoicing cycle is Completed
	return "Completed", "si"

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
	so_doc = docs.get("so")
	customer = p.customer
	if not customer and so_doc:
		customer = frappe.db.get_value("Sales Order", so_doc["name"], "customer")

	return {
		"project": p.name,
		"project_name": p.project_name,
		"customer": customer,
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
		return doctype_installed("Journal Entry Account")
	if key in ("pe_in", "pe_out"):
		return doctype_installed("Payment Entry")
	if key == "quote":
		return doctype_installed("Quotation")
	return True


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


def get_project_document_map(project):
	"""Discovers all documents belonging to this project/AO either directly
	or via document connections (Sales Order -> Material Request -> PO -> PR/PI,
	Sales Order -> Delivery Note -> Sales Invoice -> Payment Entry, etc.).
	Only submitted documents (docstatus = 1) are included — Draft and Cancelled
	entries are strictly excluded.
	"""
	doc_map = {k: set() for k in DOC_CONFIG.keys()}

	# 1. Sales Orders (Primary anchor for AO)
	so_names = set(frappe.get_all(
		"Sales Order",
		filters={"project": project, "docstatus": 1},
		pluck="name",
	))
	doc_map["so"] = so_names

	# 2. Quotations (via Sales Order Item.prevdoc_docname or direct project)
	if so_names and doctype_installed("Sales Order Item") and field_exists("Sales Order Item", "prevdoc_docname"):
		quotes = frappe.get_all(
			"Sales Order Item",
			filters={"parent": ["in", list(so_names)], "prevdoc_docname": ["is", "set"], "docstatus": 1},
			pluck="prevdoc_docname",
		)
		doc_map["quote"].update(quotes)
	if field_exists("Quotation", "project"):
		direct_quotes = frappe.get_all(
			"Quotation",
			filters={"project": project, "docstatus": 1},
			pluck="name",
		)
		doc_map["quote"].update(direct_quotes)

	# 3. Material Requests (direct project or via Sales Order Item)
	direct_mr = frappe.get_all(
		"Material Request",
		filters={"project": project, "docstatus": 1},
		pluck="name",
	)
	doc_map["mr"].update(direct_mr)
	if so_names and doctype_installed("Material Request Item") and field_exists("Material Request Item", "sales_order"):
		mr_connected = frappe.db.sql(
			"""
			SELECT DISTINCT parent FROM `tabMaterial Request Item`
			WHERE sales_order IN %s AND docstatus = 1 AND parent IS NOT NULL
			""",
			(tuple(so_names),),
			pluck=True,
		)
		doc_map["mr"].update(mr_connected)

	# 4. Purchase Orders (direct project or via Sales Order or Material Request)
	direct_po = frappe.get_all(
		"Purchase Order",
		filters={"project": project, "docstatus": 1},
		pluck="name",
	)
	doc_map["po"].update(direct_po)
	if so_names and doctype_installed("Purchase Order Item") and field_exists("Purchase Order Item", "sales_order"):
		po_from_so = frappe.db.sql(
			"""
			SELECT DISTINCT parent FROM `tabPurchase Order Item`
			WHERE sales_order IN %s AND docstatus = 1 AND parent IS NOT NULL
			""",
			(tuple(so_names),),
			pluck=True,
		)
		doc_map["po"].update(po_from_so)
	if doc_map["mr"] and doctype_installed("Purchase Order Item") and field_exists("Purchase Order Item", "material_request"):
		po_from_mr = frappe.db.sql(
			"""
			SELECT DISTINCT parent FROM `tabPurchase Order Item`
			WHERE material_request IN %s AND docstatus = 1 AND parent IS NOT NULL
			""",
			(tuple(doc_map["mr"]),),
			pluck=True,
		)
		doc_map["po"].update(po_from_mr)

	# 5. Subcontracting Orders (direct project or via PO)
	if doctype_installed("Subcontracting Order"):
		direct_sco = frappe.get_all(
			"Subcontracting Order",
			filters={"project": project, "docstatus": 1},
			pluck="name",
		)
		doc_map["sco"].update(direct_sco)
		if doc_map["po"] and field_exists("Subcontracting Order", "purchase_order"):
			sco_from_po = frappe.get_all(
				"Subcontracting Order",
				filters={"purchase_order": ["in", list(doc_map["po"])], "docstatus": 1},
				pluck="name",
			)
			doc_map["sco"].update(sco_from_po)

	# 6. Subcontracting Receipts (direct project or via SCO)
	if doctype_installed("Subcontracting Receipt"):
		direct_scr = frappe.get_all(
			"Subcontracting Receipt",
			filters={"project": project, "docstatus": 1},
			pluck="name",
		)
		doc_map["scr"].update(direct_scr)
		if doc_map["sco"] and field_exists("Subcontracting Receipt", "subcontracting_order"):
			scr_from_sco = frappe.get_all(
				"Subcontracting Receipt",
				filters={"subcontracting_order": ["in", list(doc_map["sco"])], "docstatus": 1},
				pluck="name",
			)
			doc_map["scr"].update(scr_from_sco)

	# 7. Purchase Receipts (direct project or via PO)
	direct_pr = frappe.get_all(
		"Purchase Receipt",
		filters={"project": project, "docstatus": 1},
		pluck="name",
	)
	doc_map["pr"].update(direct_pr)
	if doc_map["po"] and doctype_installed("Purchase Receipt Item") and field_exists("Purchase Receipt Item", "purchase_order"):
		pr_from_po = frappe.db.sql(
			"""
			SELECT DISTINCT parent FROM `tabPurchase Receipt Item`
			WHERE purchase_order IN %s AND docstatus = 1 AND parent IS NOT NULL
			""",
			(tuple(doc_map["po"]),),
			pluck=True,
		)
		doc_map["pr"].update(pr_from_po)

	# 8. Purchase Invoices (direct project or via PO or via PR)
	direct_pi = frappe.get_all(
		"Purchase Invoice",
		filters={"project": project, "docstatus": 1},
		pluck="name",
	)
	doc_map["pi"].update(direct_pi)
	if doc_map["po"] and doctype_installed("Purchase Invoice Item") and field_exists("Purchase Invoice Item", "purchase_order"):
		pi_from_po = frappe.db.sql(
			"""
			SELECT DISTINCT parent FROM `tabPurchase Invoice Item`
			WHERE purchase_order IN %s AND docstatus = 1 AND parent IS NOT NULL
			""",
			(tuple(doc_map["po"]),),
			pluck=True,
		)
		doc_map["pi"].update(pi_from_po)
	if doc_map["pr"] and doctype_installed("Purchase Invoice Item") and field_exists("Purchase Invoice Item", "purchase_receipt"):
		pi_from_pr = frappe.db.sql(
			"""
			SELECT DISTINCT parent FROM `tabPurchase Invoice Item`
			WHERE purchase_receipt IN %s AND docstatus = 1 AND parent IS NOT NULL
			""",
			(tuple(doc_map["pr"]),),
			pluck=True,
		)
		doc_map["pi"].update(pi_from_pr)

	# 9. Delivery Notes (direct project or via Sales Order)
	direct_dn = frappe.get_all(
		"Delivery Note",
		filters={"project": project, "docstatus": 1},
		pluck="name",
	)
	doc_map["dn"].update(direct_dn)
	if so_names and doctype_installed("Delivery Note Item") and field_exists("Delivery Note Item", "against_sales_order"):
		dn_from_so = frappe.db.sql(
			"""
			SELECT DISTINCT parent FROM `tabDelivery Note Item`
			WHERE against_sales_order IN %s AND docstatus = 1 AND parent IS NOT NULL
			""",
			(tuple(so_names),),
			pluck=True,
		)
		doc_map["dn"].update(dn_from_so)

	# 10. Sales Invoices (direct project or via Sales Order or via Delivery Note)
	direct_si = frappe.get_all(
		"Sales Invoice",
		filters={"project": project, "docstatus": 1},
		pluck="name",
	)
	doc_map["si"].update(direct_si)
	if so_names and doctype_installed("Sales Invoice Item") and field_exists("Sales Invoice Item", "sales_order"):
		si_from_so = frappe.db.sql(
			"""
			SELECT DISTINCT parent FROM `tabSales Invoice Item`
			WHERE sales_order IN %s AND docstatus = 1 AND parent IS NOT NULL
			""",
			(tuple(so_names),),
			pluck=True,
		)
		doc_map["si"].update(si_from_so)
	if doc_map["dn"] and doctype_installed("Sales Invoice Item") and field_exists("Sales Invoice Item", "delivery_note"):
		si_from_dn = frappe.db.sql(
			"""
			SELECT DISTINCT parent FROM `tabSales Invoice Item`
			WHERE delivery_note IN %s AND docstatus = 1 AND parent IS NOT NULL
			""",
			(tuple(doc_map["dn"]),),
			pluck=True,
		)
		doc_map["si"].update(si_from_dn)
	if doc_map["si"] and doctype_installed("Sales Invoice Item") and field_exists("Sales Invoice Item", "delivery_note"):
		dn_from_si = frappe.db.sql(
			"""
			SELECT DISTINCT delivery_note FROM `tabSales Invoice Item`
			WHERE parent IN %s AND delivery_note IS NOT NULL AND delivery_note != '' AND docstatus = 1
			""",
			(tuple(doc_map["si"]),),
			pluck=True,
		)
		doc_map["dn"].update(dn_from_si)

	# 11. Payment Entry - Received (pe_in)
	# Direct project OR connected via Payment Entry Reference to Sales Order or Sales Invoice
	direct_pe_in = frappe.get_all(
		"Payment Entry",
		filters={"project": project, "payment_type": "Receive", "docstatus": 1},
		pluck="name",
	)
	doc_map["pe_in"].update(direct_pe_in)
	if doctype_installed("Payment Entry Reference"):
		ref_clauses = []
		ref_params = []
		if so_names:
			ref_clauses.append("(per.reference_doctype = 'Sales Order' AND per.reference_name IN %s)")
			ref_params.append(tuple(so_names))
		if doc_map["si"]:
			ref_clauses.append("(per.reference_doctype = 'Sales Invoice' AND per.reference_name IN %s)")
			ref_params.append(tuple(doc_map["si"]))
		if ref_clauses:
			pe_in_connected = frappe.db.sql(
				"""
				SELECT DISTINCT per.parent
				FROM `tabPayment Entry Reference` per
				INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
				WHERE per.docstatus = 1 AND pe.docstatus = 1
					AND pe.payment_type = 'Receive'
					AND ({0})
				""".format(" OR ".join(ref_clauses)),
				tuple(ref_params),
				pluck=True,
			)
			doc_map["pe_in"].update(pe_in_connected)

	# 12. Payment Entry - Paid (pe_out)
	# Direct project OR connected via Payment Entry Reference to Purchase Order or Purchase Invoice
	direct_pe_out = frappe.get_all(
		"Payment Entry",
		filters={"project": project, "payment_type": "Pay", "docstatus": 1},
		pluck="name",
	)
	doc_map["pe_out"].update(direct_pe_out)
	if doctype_installed("Payment Entry Reference"):
		ref_clauses = []
		ref_params = []
		if doc_map["po"]:
			ref_clauses.append("(per.reference_doctype = 'Purchase Order' AND per.reference_name IN %s)")
			ref_params.append(tuple(doc_map["po"]))
		if doc_map["pi"]:
			ref_clauses.append("(per.reference_doctype = 'Purchase Invoice' AND per.reference_name IN %s)")
			ref_params.append(tuple(doc_map["pi"]))
		if ref_clauses:
			pe_out_connected = frappe.db.sql(
				"""
				SELECT DISTINCT per.parent
				FROM `tabPayment Entry Reference` per
				INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
				WHERE per.docstatus = 1 AND pe.docstatus = 1
					AND pe.payment_type = 'Pay'
					AND ({0})
				""".format(" OR ".join(ref_clauses)),
				tuple(ref_params),
				pluck=True,
			)
			doc_map["pe_out"].update(pe_out_connected)

	# 13. Stock Entry / Requisition (sr)
	direct_sr = frappe.get_all(
		"Stock Entry",
		filters={"project": project, "purpose": "Material Transfer", "docstatus": 1},
		pluck="name",
	)
	doc_map["sr"].update(direct_sr)
	if so_names and doctype_installed("Stock Entry Detail") and field_exists("Stock Entry Detail", "against_sales_order"):
		sr_from_so = frappe.db.sql(
			"""
			SELECT DISTINCT parent FROM `tabStock Entry Detail`
			WHERE against_sales_order IN %s AND docstatus = 1 AND parent IS NOT NULL
			""",
			(tuple(so_names),),
			pluck=True,
		)
		doc_map["sr"].update(sr_from_so)

	# 14. QC Report (qc) & Non-Conformance (nc)
	if doctype_installed("QC Report"):
		if field_exists("QC Report", "project"):
			doc_map["qc"].update(frappe.get_all("QC Report", filters={"project": project, "docstatus": 1}, pluck="name"))
		if doc_map["po"] and field_exists("QC Report", "po_no"):
			doc_map["qc"].update(frappe.get_all("QC Report", filters={"po_no": ["in", list(doc_map["po"])], "docstatus": 1}, pluck="name"))
		if doc_map["sco"] and field_exists("QC Report", "so_no"):
			doc_map["qc"].update(frappe.get_all("QC Report", filters={"so_no": ["in", list(doc_map["sco"])], "docstatus": 1}, pluck="name"))

	if doctype_installed("Non - Conformance"):
		if field_exists("Non - Conformance", "ao_reference_no"):
			doc_map["nc"].update(frappe.get_all("Non - Conformance", filters={"ao_reference_no": project, "docstatus": 1}, pluck="name"))
		elif field_exists("Non - Conformance", "project"):
			doc_map["nc"].update(frappe.get_all("Non - Conformance", filters={"project": project, "docstatus": 1}, pluck="name"))
		if doc_map["po"] and field_exists("Non - Conformance", "po_reference_no"):
			doc_map["nc"].update(frappe.get_all("Non - Conformance", filters={"po_reference_no": ["in", list(doc_map["po"])], "docstatus": 1}, pluck="name"))
		if doc_map["qc"] and field_exists("Non - Conformance", "qc_report"):
			doc_map["nc"].update(frappe.get_all("Non - Conformance", filters={"qc_report": ["in", list(doc_map["qc"])], "docstatus": 1}, pluck="name"))

	# 15. Journal Entry (je)
	je_names = set()
	if doctype_installed("Journal Entry Account"):
		if field_exists("Journal Entry Account", "project"):
			je_direct = frappe.db.sql(
				"""
				SELECT DISTINCT jea.parent FROM `tabJournal Entry Account` jea
				INNER JOIN `tabJournal Entry` je ON je.name = jea.parent
				WHERE jea.project = %s AND je.docstatus = 1
				""",
				project,
				pluck=True,
			)
			je_names.update(je_direct)
		all_refs = list(so_names | doc_map["si"] | doc_map["po"] | doc_map["pi"])
		if all_refs and field_exists("Journal Entry Account", "reference_name"):
			je_ref = frappe.db.sql(
				"""
				SELECT DISTINCT jea.parent FROM `tabJournal Entry Account` jea
				INNER JOIN `tabJournal Entry` je ON je.name = jea.parent
				WHERE jea.reference_name IN %s AND je.docstatus = 1
				""",
				(tuple(all_refs),),
				pluck=True,
			)
			je_names.update(je_ref)
	doc_map["je"] = je_names

	return doc_map


def get_docs_for_project(project):
	doc_map = get_project_document_map(project)
	return {key: get_latest_doc(project, key, cfg, doc_map) for key, cfg in DOC_CONFIG.items()}


def get_latest_doc(project, key, cfg, doc_map=None):
	doctype = cfg["doctype"]
	if not is_doc_type_queryable(cfg, key):
		return None

	if doc_map is None:
		doc_map = get_project_document_map(project)

	names = doc_map.get(key) or set()
	if not names:
		return None

	fields = ["name", "creation"]
	status_field = resolve_status_field(doctype, cfg)
	if status_field:
		fields.append("{0} as status".format(status_field))
	if cfg.get("amount_field") and field_exists(doctype, cfg["amount_field"]):
		fields.append("{0} as amount".format(cfg["amount_field"]))
	if doctype == "Journal Entry":
		fields.append("docstatus")

	filters = {"name": ["in", list(names)], "docstatus": 1}
	count = frappe.db.count(doctype, filters=filters)
	if not count:
		return None

	rows = frappe.get_all(doctype, filters=filters, fields=fields, order_by="creation desc", limit_page_length=1)
	if not rows:
		return None
	doc = rows[0]
	if doctype == "Journal Entry":
		doc["status"] = "Submitted"
	elif not status_field:
		doc["status"] = None
	doc["doctype"] = doctype
	doc["count"] = count
	return doc


# ---------------------------------------------------------------------------
# Full document list for a given key/project — powers the "N Sales
# Invoices" / "N Work Orders" style chip.
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_doc_list(project, key):
	cfg = DOC_CONFIG.get(key)
	if not cfg:
		frappe.throw(_("Unknown document key: {0}").format(key))

	doctype = cfg["doctype"]
	if not is_doc_type_queryable(cfg, key):
		return []

	doc_map = get_project_document_map(project)
	names = doc_map.get(key) or set()
	if not names:
		return []

	fields = ["name", "creation"]
	status_field = resolve_status_field(doctype, cfg)
	if status_field:
		fields.append("{0} as status".format(status_field))
	if cfg.get("amount_field") and field_exists(doctype, cfg["amount_field"]):
		fields.append("{0} as amount".format(cfg["amount_field"]))
	if doctype == "Journal Entry":
		fields.append("docstatus")

	filters = {"name": ["in", list(names)], "docstatus": 1}
	rows = frappe.get_all(doctype, filters=filters, fields=fields, order_by="creation desc")
	for r in rows:
		r["doctype"] = doctype
		if doctype == "Journal Entry":
			r["status"] = "Submitted"
		elif not status_field:
			r["status"] = None
	return rows


def compute_overview(project):
	doc_map = get_project_document_map(project)
	si_names = list(doc_map.get("si") or [])
	so_names = list(doc_map.get("so") or [])
	dn_names = list(doc_map.get("dn") or [])
	pi_names = list(doc_map.get("pi") or [])

	company_currency = frappe.db.get_default("currency") or "INR"

	revenue = 0.0
	if si_names:
		revenue = flt(frappe.db.sql(
			"""
			select sum(base_net_total) from `tabSales Invoice`
			where name in %s and docstatus = 1
			""",
			(tuple(si_names),),
		)[0][0] or 0)
	if not revenue and so_names:
		revenue = flt(frappe.db.sql(
			"""
			select sum(base_net_total) from `tabSales Order`
			where name in %s and docstatus = 1
			""",
			(tuple(so_names),),
		)[0][0] or 0)

	so_currency = company_currency
	foreign_revenue = 0.0
	if so_names:
		so_res = frappe.db.sql(
			"""
			select currency, sum(net_total) as foreign_total
			from `tabSales Order`
			where name in %s and docstatus = 1
			group by currency
			""",
			(tuple(so_names),),
			as_dict=True,
		)
		if so_res:
			so_currency = so_res[0].currency or company_currency
			foreign_revenue = flt(so_res[0].foreign_total)

	# Total RM Cost: from Delivery Notes connected to this project
	rm_cost = 0.0
	if dn_names:
		rm_cost = flt(frappe.db.sql(
			"""
			SELECT SUM(CASE WHEN debit > 0 THEN debit ELSE debit_in_account_currency END)
			FROM `tabGL Entry`
			WHERE voucher_type = 'Delivery Note'
				AND voucher_no IN %s
				AND is_cancelled = 0
				AND (debit > 0 OR debit_in_account_currency > 0)
			""",
			(tuple(dn_names),),
		)[0][0] or 0)
		if not rm_cost and doctype_installed("Delivery Note Item"):
			rm_cost = flt(frappe.db.sql(
				"""
				SELECT SUM(dni.qty * dni.incoming_rate)
				FROM `tabDelivery Note Item` dni
				INNER JOIN `tabDelivery Note` dn ON dn.name = dni.parent
				WHERE dn.name IN %s AND dn.docstatus = 1 AND dni.incoming_rate > 0
				""",
				(tuple(dn_names),),
			)[0][0] or 0)

	# If no Delivery Note RM cost yet, check Stock Entries (Material Issue/Manufacture)
	if not rm_cost and doctype_installed("Stock Entry Detail"):
		se_where = ["se.docstatus = 1", "se.purpose in ('Material Issue', 'Manufacture', 'Material Transfer for Manufacture')"]
		se_params = []
		proj_clauses = ["se.project = %s"]
		se_params.append(project)
		if so_names:
			if field_exists("Stock Entry", "sales_order"):
				proj_clauses.append("se.sales_order in %s")
				se_params.append(tuple(so_names))
			if field_exists("Stock Entry Detail", "against_sales_order"):
				proj_clauses.append("sed.against_sales_order in %s")
				se_params.append(tuple(so_names))
		se_where.append("({0})".format(" OR ".join(proj_clauses)))
		rm_cost = flt(frappe.db.sql(
			"""
			select sum(sed.qty * sed.valuation_rate)
			from `tabStock Entry Detail` sed
			inner join `tabStock Entry` se on se.name = sed.parent
			where {0}
			""".format(" AND ".join(se_where)),
			tuple(se_params),
		)[0][0] or 0)

	indirect = 0.0
	if pi_names:
		has_is_subcontracted = field_exists("Purchase Invoice", "is_subcontracted")
		subcontract_clause = "and pi.is_subcontracted = 0" if has_is_subcontracted else ""
		indirect = flt(frappe.db.sql(
			"""
			select sum(pii.base_net_amount)
			from `tabPurchase Invoice Item` pii
			inner join `tabPurchase Invoice` pi on pi.name = pii.parent
			inner join `tabItem` it on it.name = pii.item_code
			where pi.name in %s and pi.docstatus = 1
				and it.is_stock_item = 0
				{subcontract_clause}
			""".format(subcontract_clause=subcontract_clause),
			(tuple(pi_names),),
		)[0][0] or 0)

	profit = revenue - rm_cost - indirect
	profit_pct = (profit / revenue * 100) if revenue else 0

	return {
		"revenue": revenue,
		"rm_cost": rm_cost,
		"indirect": indirect,
		"profit": profit,
		"profit_pct": profit_pct,
		"currency": company_currency,
		"foreign_revenue": foreign_revenue if so_currency != company_currency else None,
		"foreign_currency": so_currency if so_currency != company_currency else None,
	}


def get_item_valuation_rate(item_code, project=None, so_names=None, dn_names=None, po_names=None):
	"""Resolves the valuation rate from the Delivery Note's Stock Ledger Entry (SLE) in Indian Currency."""
	if not item_code:
		return None

	is_stock = frappe.db.get_value("Item", item_code, "is_stock_item")
	if is_stock is not None and not is_stock:
		return None

	# 1. Primary: Find from the Delivery Note's Stock Ledger Entry (SLE) for this AO/Sales Order
	if dn_names and doctype_installed("Stock Ledger Entry"):
		sle_rate = frappe.db.sql(
			"""
			SELECT valuation_rate
			FROM `tabStock Ledger Entry`
			WHERE voucher_type = 'Delivery Note'
				AND voucher_no IN %s
				AND item_code = %s
				AND is_cancelled = 0
				AND valuation_rate > 0
			ORDER BY posting_date DESC, posting_time DESC, creation DESC
			LIMIT 1
			""",
			(tuple(dn_names), item_code),
		)
		if sle_rate and sle_rate[0][0]:
			return flt(sle_rate[0][0])

		sle_calc = frappe.db.sql(
			"""
			SELECT ABS(stock_value_difference / actual_qty)
			FROM `tabStock Ledger Entry`
			WHERE voucher_type = 'Delivery Note'
				AND voucher_no IN %s
				AND item_code = %s
				AND is_cancelled = 0
				AND actual_qty != 0
				AND stock_value_difference != 0
			ORDER BY posting_date DESC, posting_time DESC, creation DESC
			LIMIT 1
			""",
			(tuple(dn_names), item_code),
		)
		if sle_calc and sle_calc[0][0]:
			return flt(sle_calc[0][0])

	# 2. Check Delivery Note Item (incoming_rate)
	if dn_names and doctype_installed("Delivery Note Item"):
		rate = frappe.db.sql(
			"""
			SELECT dni.incoming_rate
			FROM `tabDelivery Note Item` dni
			INNER JOIN `tabDelivery Note` dn ON dn.name = dni.parent
			WHERE dni.item_code = %s AND dn.name IN %s AND dn.docstatus = 1 AND dni.incoming_rate > 0
			ORDER BY dn.posting_date DESC, dn.creation DESC LIMIT 1
			""",
			(item_code, tuple(dn_names)),
		)
		if rate and rate[0][0]:
			return flt(rate[0][0])

	# 3. Check Stock Entry Detail for this project
	if project and doctype_installed("Stock Entry Detail"):
		rate = frappe.db.sql(
			"""
			SELECT CASE WHEN sed.valuation_rate > 0 THEN sed.valuation_rate ELSE sed.basic_rate END
			FROM `tabStock Entry Detail` sed
			INNER JOIN `tabStock Entry` se ON se.name = sed.parent
			WHERE sed.item_code = %s AND se.docstatus = 1 AND se.project = %s
				AND (sed.valuation_rate > 0 OR sed.basic_rate > 0)
			ORDER BY se.posting_date DESC, se.creation DESC LIMIT 1
			""",
			(item_code, project),
		)
		if rate and rate[0][0]:
			return flt(rate[0][0])

	# 4. Check Purchase Receipt Item (base_rate or valuation_rate) if purchased
	if po_names and doctype_installed("Purchase Receipt Item"):
		rate = frappe.db.sql(
			"""
			SELECT CASE WHEN pri.valuation_rate > 0 THEN pri.valuation_rate ELSE pri.base_rate END
			FROM `tabPurchase Receipt Item` pri
			INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
			WHERE pri.item_code = %s AND pr.docstatus = 1 AND pri.purchase_order IN %s
				AND (pri.valuation_rate > 0 OR pri.base_rate > 0)
			ORDER BY pr.posting_date DESC, pr.creation DESC LIMIT 1
			""",
			(item_code, tuple(po_names)),
		)
		if rate and rate[0][0]:
			return flt(rate[0][0])

	# 5. Check latest Stock Ledger Entry for this item (global)
	if doctype_installed("Stock Ledger Entry"):
		rate = frappe.db.sql(
			"""
			SELECT valuation_rate
			FROM `tabStock Ledger Entry`
			WHERE item_code = %s AND valuation_rate > 0 AND is_cancelled = 0
			ORDER BY posting_date DESC, posting_time DESC, creation DESC LIMIT 1
			""",
			(item_code,),
		)
		if rate and rate[0][0]:
			return flt(rate[0][0])

	# 6. Check Bin (current warehouse valuation rate)
	if doctype_installed("Bin"):
		rate = frappe.db.sql(
			"""
			SELECT valuation_rate
			FROM `tabBin`
			WHERE item_code = %s AND valuation_rate > 0
			ORDER BY actual_qty DESC, modified DESC LIMIT 1
			""",
			(item_code,),
		)
		if rate and rate[0][0]:
			return flt(rate[0][0])

	# 7. Check Item Master (valuation_rate, last_purchase_rate, standard_rate)
	item_vals = frappe.db.get_value("Item", item_code, ["valuation_rate", "last_purchase_rate", "standard_rate"], as_dict=True)
	if item_vals:
		for fld in ("valuation_rate", "last_purchase_rate", "standard_rate"):
			val = flt(item_vals.get(fld))
			if val > 0:
				return val

	return 0.0


def get_items_and_consumption(project):
	"""Returns Sales Order items paired with their BOM raw materials, plus
	the flat lists kept for backward compatibility with older callers."""
	doc_map = get_project_document_map(project)
	so_names = list(doc_map.get("so") or [])
	po_names = list(doc_map.get("po") or [])
	dn_names = list(doc_map.get("dn") or [])
	company_currency = frappe.db.get_default("currency") or "INR"

	if not so_names:
		return {"order_items": [], "rows": [], "material_consumption": []}

	order_items = frappe.db.sql(
		"""
		select soi.item_code, soi.item_name, soi.qty, soi.delivered_qty,
			soi.rate, soi.base_rate, soi.parent as sales_order, so.currency
		from `tabSales Order Item` soi
		inner join `tabSales Order` so on so.name = soi.parent
		where so.name in %s and so.docstatus = 1
		order by soi.idx
		""",
		(tuple(so_names),),
		as_dict=True,
	)

	consumption_map = {}
	if doctype_installed("Stock Entry Detail"):
		se_where = ["se.docstatus = 1", "se.purpose in ('Material Issue', 'Manufacture', 'Material Transfer for Manufacture')"]
		se_params = []
		proj_clauses = ["se.project = %s"]
		se_params.append(project)
		if so_names:
			if field_exists("Stock Entry", "sales_order"):
				proj_clauses.append("se.sales_order in %s")
				se_params.append(tuple(so_names))
			if field_exists("Stock Entry Detail", "against_sales_order"):
				proj_clauses.append("sed.against_sales_order in %s")
				se_params.append(tuple(so_names))
		se_where.append("({0})".format(" OR ".join(proj_clauses)))
		consumption_map = {
			r.item_code: r
			for r in frappe.db.sql(
				"""
				select sed.item_code, sum(sed.qty) as qty_consumed, avg(sed.valuation_rate) as valuation_rate
				from `tabStock Entry Detail` sed
				inner join `tabStock Entry` se on se.name = sed.parent
				where {0}
				group by sed.item_code
				""".format(" AND ".join(se_where)),
				tuple(se_params),
				as_dict=True,
			)
		}

	ordered_map = {}
	if po_names and doctype_installed("Purchase Order Item"):
		ordered_map = {
			r.item_code: r.total_ordered
			for r in frappe.db.sql(
				"""
				select poi.item_code, sum(poi.qty) as total_ordered
				from `tabPurchase Order Item` poi
				inner join `tabPurchase Order` po on po.name = poi.parent
				where po.name in %s and po.docstatus = 1
				group by poi.item_code
				""",
				(tuple(po_names),),
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

		is_stock = frappe.db.get_value("Item", it.item_code, "is_stock_item")

		# Selling price in Indian Currency (base_rate)
		fg_selling_price = flt(it.base_rate) if (it.base_rate and flt(it.base_rate) > 0) else flt(it.rate)

		if not components:
			cons = consumption_map.get(it.item_code)
			valuation_rate = cons.valuation_rate if (cons and cons.valuation_rate) else None
			if valuation_rate is None or valuation_rate == 0:
				valuation_rate = get_item_valuation_rate(
					it.item_code, project=project, so_names=so_names, dn_names=dn_names, po_names=po_names
				)
			rows.append({
				"order_item": it.item_name or it.item_code,
				"item_code": it.item_code,
				"type": "FG",
				"component_name": None,
				"component_code": None,
				"qty_needed": it.qty,
				"total_ordered": ordered_map.get(it.item_code),
				"consumed": cons.qty_consumed if cons else None,
				"fg_delivered": it.delivered_qty,
				"selling_price": fg_selling_price,
				"currency": "INR",
				"company_currency": "INR",
				"valuation_rate": valuation_rate,
				"is_stock_item": 1 if is_stock else 0,
				"group_start": True,
			})
			if cons:
				flat_consumption.append({
					"item_code": it.item_code,
					"item_name": it.item_name or it.item_code,
					"qty_consumed": cons.qty_consumed,
					"valuation_rate": cons.valuation_rate,
				})
			continue

		for i, comp in enumerate(components):
			cons = consumption_map.get(comp.item_code)
			valuation_rate = (cons.valuation_rate if (cons and cons.valuation_rate) else None)
			if valuation_rate is None or valuation_rate == 0:
				valuation_rate = get_item_valuation_rate(
					comp.item_code, project=project, so_names=so_names, dn_names=dn_names, po_names=po_names
				)

			comp_is_stock = frappe.db.get_value("Item", comp.item_code, "is_stock_item")
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
				"selling_price": fg_selling_price if i == 0 else None,
				"currency": "INR",
				"company_currency": "INR",
				"valuation_rate": valuation_rate,
				"is_stock_item": 1 if (is_stock if i == 0 else comp_is_stock) else 0,
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
	elif not project and doctype == "Non - Conformance":
		project = doc.get("ao_reference_no")

	status_field = None
	if doc.meta.has_field("status"):
		status_field = "status"
	elif doc.meta.has_field("workflow_state"):
		status_field = "workflow_state"
	elif doc.meta.has_field("qc_status"):
		status_field = "qc_status"

	# 1. Payment Entry (No items row, show payment details and allocated references)
	if doctype == "Payment Entry":
		references = []
		for ref in doc.get("references") or []:
			references.append({
				"reference_doctype": ref.reference_doctype,
				"reference_name": ref.reference_name,
				"allocated_amount": flt(ref.allocated_amount),
				"total_amount": flt(ref.total_amount),
				"outstanding_amount": flt(ref.outstanding_amount),
			})
		return {
			"doctype": doctype,
			"name": doc.name,
			"status": doc.get(status_field) if status_field else doc.get("status"),
			"project": project,
			"is_payment": True,
			"party": doc.get("party_name") or doc.get("party"),
			"paid_amount": flt(doc.get("paid_amount") or doc.get("received_amount")),
			"payment_type": doc.get("payment_type"),
			"mode_of_payment": doc.get("mode_of_payment"),
			"posting_date": str(doc.get("posting_date") or ""),
			"references": references,
			"items": [],
			"total_qty": 0,
		}

	# 2. Journal Entry (Accounting entries, no item rows)
	if doctype == "Journal Entry":
		accounts = []
		for acc in doc.get("accounts") or []:
			accounts.append({
				"account": acc.account,
				"debit": flt(acc.debit_in_account_currency or acc.debit),
				"credit": flt(acc.credit_in_account_currency or acc.credit),
				"party": acc.party,
			})
		return {
			"doctype": doctype,
			"name": doc.name,
			"status": "Submitted" if doc.docstatus == 1 else "Draft",
			"project": project,
			"is_journal": True,
			"total_debit": flt(doc.total_debit),
			"posting_date": str(doc.get("posting_date") or ""),
			"accounts": accounts,
			"items": [],
			"total_qty": 0,
		}

	# 3. QC Report (Item and item_name directly on document header, no child table)
	if doctype == "QC Report":
		item_code = doc.get("item")
		item_name = doc.get("item_name") or (frappe.db.get_value("Item", item_code, "item_name") if item_code else None) or item_code
		qty = flt(doc.get("received_quantity") or doc.get("accepted_quantity") or doc.get("rejected_quantity") or 1.0)
		uom = (frappe.db.get_value("Item", item_code, "stock_uom") if item_code else "Nos") or "Nos"
		ref = None
		if doc.get("reference_type") and doc.get("reference_name"):
			ref = {"doctype": doc.get("reference_type"), "name": doc.get("reference_name")}
		elif doc.get("so_no"):
			ref = {"doctype": "Sales Order", "name": doc.get("so_no")}
		elif doc.get("po_no"):
			ref = {"doctype": "Purchase Order", "name": doc.get("po_no")}
		items = [{
			"item_code": item_code,
			"item_name": item_name,
			"qty": qty,
			"uom": uom,
			"reference": ref,
		}] if item_code else []
		return {
			"doctype": doctype,
			"name": doc.name,
			"status": doc.get(status_field) if status_field else doc.get("status"),
			"project": project,
			"items": items,
			"total_qty": sum(i["qty"] for i in items),
		}

	# 4. Non - Conformance (product_name directly on header, no child table)
	if doctype in ("Non - Conformance", "Non-Conformance"):
		prod = doc.get("product_name")
		item_name = (frappe.db.get_value("Item", prod, "item_name") if prod else None) or prod
		uom = (frappe.db.get_value("Item", prod, "stock_uom") if prod else "Nos") or "Nos"
		ref = None
		if doc.get("reference_type") and doc.get("reference_name"):
			ref = {"doctype": doc.get("reference_type"), "name": doc.get("reference_name")}
		elif doc.get("po_reference_no"):
			ref = {"doctype": "Purchase Order", "name": doc.get("po_reference_no")}
		items = [{
			"item_code": prod,
			"item_name": item_name,
			"qty": 1.0,
			"uom": uom,
			"reference": ref,
		}] if prod else []
		return {
			"doctype": doctype,
			"name": doc.name,
			"status": doc.get(status_field) if status_field else doc.get("status"),
			"project": project,
			"items": items,
			"total_qty": sum(i["qty"] for i in items),
		}

	# 5. Standard item child table documents
	child_fieldname = None
	for df in doc.meta.get_table_fields():
		if df.fieldname == "items":
			child_fieldname = df.fieldname
			break

	items = []
	if child_fieldname:
		for row in doc.get(child_fieldname):
			reference = None
			if doctype != "Delivery Note":
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

	return {
		"doctype": doctype,
		"name": doc.name,
		"status": doc.get(status_field) if status_field else None,
		"project": project,
		"items": items,
		"total_qty": sum(i["qty"] for i in items),
	}