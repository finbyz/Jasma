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
# CHANGELOG vs. the previous version (fixing issues found against the
# wireframe):
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
#   - NEW: `get_doc_list` endpoint. When a project has MORE THAN ONE
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
# Receipt -> Delivery Note -> Sales Invoice.
LIST_DOC_KEYS = ["mr", "po", "sco", "scr", "pr", "dn", "si"]

DOC_CONFIG = {
	"quote": {
		"doctype": "Quotation", "label": "Quotation", "short": "QTN",
		"status_field": "status", "amount_field": "grand_total", "project_field": "project",
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
		"doctype": "Quality Inspection", "label": "QC Report", "short": "QC",
		"status_field": "status", "amount_field": None, "project_field": None,
	},
	"nc": {
		"doctype": "Non Conformance", "label": "Non-Conformance", "short": "NC",
		"status_field": "status", "amount_field": None, "project_field": None,
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

# Simplified milestone strip shown on the list view
STAGE_MILESTONES = ["so", "mr", "po", "pr", "si"]

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

	projects = frappe.get_all(
		"Project",
		filters=filters,
		fields=["name", "project_name", "customer", "creation", "status"],
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
		pending_at, stage_key = determine_pending(docs)
		severity = determine_severity(p.creation, stage_key)
		result.append({
			"project": p.name,
			"project_name": p.project_name,
			"so": so_doc["name"] if so_doc else None,
			"customer": p.customer,
			"date": str(getdate(p.creation)) if p.creation else None,
			"pending_at": pending_at,
			"severity": severity,
			# Full procurement trail now shown on the list grid, not just
			# MR/PO/DN/SI — each doc carries its own `doctype` so the
			# frontend can route to the right form without guessing.
			"docs": {k: docs.get(k) for k in LIST_DOC_KEYS},
			"stage": {k: bool(docs.get(k)) for k in STAGE_MILESTONES},
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

	return "\u2014", None


def determine_severity(project_creation, pending_stage_key):
	if not pending_stage_key:
		return "Low"
	days = date_diff(today(), project_creation)
	if days > 30:
		return "High"
	if days > 14:
		return "Medium"
	return "Low"


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
				# lets the frontend show "Not applicable" instead of
				# "Not generated" when the doctype/field genuinely isn't
				# usable on this site, rather than looking like a bug.
				"queryable": is_doc_type_queryable(cfg),
			}
			for k, cfg in DOC_CONFIG.items()
		},
		"doc_order": DOC_ORDER,
	}


def is_doc_type_queryable(cfg):
	if not doctype_installed(cfg["doctype"]):
		return False
	if cfg["doctype"] == "Journal Entry":
		return doctype_installed("Journal Entry Account") and field_exists("Journal Entry Account", "project")
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


def get_docs_for_project(project):
	return {key: get_latest_doc(project, key, cfg) for key, cfg in DOC_CONFIG.items()}


def get_latest_doc(project, key, cfg):
	doctype = cfg["doctype"]
	if not is_doc_type_queryable(cfg):
		return None

	if cfg.get("project_field"):
		filters = {cfg["project_field"]: project, "docstatus": ["!=", 2]}
		filters.update(cfg.get("extra_filters") or {})
		fields = ["name", "creation"]

		# Only ask the DB for a status column if one genuinely exists.
		# Newer frappe.qb rejects fake literals like "'' as status" outright
		# (PermissionError: Invalid field format for SELECT), so we can't
		# paper over a missing column in SQL — we fill it in afterwards.
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
# NEW: full document list for a given key/project — powers the "N Sales
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
	if not is_doc_type_queryable(cfg):
		return []

	if cfg.get("project_field"):
		filters = {cfg["project_field"]: project, "docstatus": ["!=", 2]}
		filters.update(cfg.get("extra_filters") or {})
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
	revenue = flt(frappe.db.sql(
		"""
		select sum(grand_total) from `tabSales Invoice`
		where project = %s and docstatus = 1
		""",
		project,
	)[0][0] or 0)
	if not revenue:
		revenue = flt(frappe.db.sql(
			"""
			select sum(grand_total) from `tabSales Order`
			where project = %s and docstatus = 1
			""",
			project,
		)[0][0] or 0)

	rm_cost = flt(frappe.db.sql(
		"""
		select sum(sle.stock_value_difference * -1)
		from `tabStock Ledger Entry` sle
		where sle.project = %s and sle.actual_qty < 0
		""",
		project,
	)[0][0] or 0)

	indirect = flt(frappe.db.get_value("Project", project, "total_costing_amount") or 0)

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