import frappe
import json
from frappe import _
from frappe.utils import get_link_to_form
from erpnext.subcontracting.doctype.subcontracting_receipt.subcontracting_receipt import SubcontractingReceipt


@frappe.whitelist()
def make_qc_report(docname, items):
	if isinstance(items, str):
		items = json.loads(items)

	reports = []

	# Same fix as Purchase Receipt: pull existing QC Reports for this SR
	# once, and flatten reference_item (which may itself already be a
	# comma-separated list of SR-item row names) into a single set, so a
	# merged-item row never gets double-flagged as missing.
	existing_reports = frappe.get_all(
		"QC Report",
		filters={
			"reference_type": "Subcontracting Receipt",
			"reference_name": docname
		},
		fields=["name", "reference_item"]
	)

	used_sr_items = set()
	for rep in existing_reports:
		for part in (rep.reference_item or "").split(","):
			part = part.strip()
			if part:
				used_sr_items.add(part)

	for item in items:
		# item.get("docname") may itself be "row1, row2" when the frontend
		# has already merged multiple SR-item rows of the same item code.
		row_names = [d.strip() for d in (item.get("docname") or "").split(",") if d.strip()]

		clash = used_sr_items.intersection(row_names)
		if clash:
			frappe.throw(
				_("QC Report already created for Item {0} (SR row(s): {1})").format(
					item.get("item_code"), ", ".join(clash)
				)
			)

		item_doc = frappe.get_doc("Item", item.get("item_code"))

		qc_report = frappe.get_doc({
			"doctype": "QC Report",
			"reference_type": "Subcontracting Receipt",
			"reference_name": docname,
			"reference_item": ", ".join(row_names),  # comma-separated SR rows
			"item_group": item_doc.item_group,
			"item": item.get("item_code"),
			"received_quantity": item.get("received_quantity"),
			"po_no": item.get("purchase_order"),
			"so_no": item.get("subcontracting_order"),
			"project": item.get("project"),
		})

		for row in item_doc.qc_report_parameter:
			qc_report.append("qc_report_parameter", {
				"description": row.description,
				"jasma_report_check": row.jasma_report_check,
				"vendor_report_check": row.vendor_report_check,
				"third_party_report_check": row.third_party_report_check
			})

		qc_report.insert(ignore_permissions=True)
		reports.append(qc_report.name)

		used_sr_items.update(row_names)

	return reports


def validate_qc_report(self, method=None):
	# NOTE: this replaces the earlier duplicate `validate_qc_report` def
	# that called SubcontractingReceipt.validate_available_qty_for_consumption
	# — that definition was dead code (Python only keeps the last def with
	# the same name in a module). If you actually need that qty-consumption
	# check to run too, call it explicitly here instead of relying on a
	# separate function of the same name:
	# SubcontractingReceipt.validate_available_qty_for_consumption(self)

	missing_items = frappe.db.sql("""
		SELECT pri.item_code
		FROM `tabSubcontracting Receipt Item` pri
		INNER JOIN `tabItem` i ON i.name = pri.item_code
		LEFT JOIN `tabQC Report` qr
			ON FIND_IN_SET(pri.name, REPLACE(REPLACE(qr.reference_item, ', ', ','), ' ', ',')) > 0
			AND qr.reference_name = pri.parent
			AND qr.reference_type = 'Subcontracting Receipt'
			AND qr.docstatus = 1
		WHERE pri.parent = %s
		AND EXISTS (
			SELECT 1
			FROM `tabQC Report Parameter` qrp
			WHERE qrp.parent = i.name
		)
		AND qr.name IS NULL
	""", self.name, as_dict=True)

	if missing_items:
		items = ", ".join([d.item_code for d in missing_items])

		frappe.throw(
			f"QC Report must be Created for items: <b>{items}</b>"
		)
  
  
def subcontracting_receipt_on_submit(doc, method=None):
	pr_item_meta = frappe.get_meta("Purchase Receipt Item")
	has_fg_item = pr_item_meta.has_field("fg_item")
	has_fg_item_name = pr_item_meta.has_field("fg_item_name")
	if not (has_fg_item or has_fg_item_name):
		return

	pr_names = frappe.get_all(
		"Purchase Receipt",
		filters={"subcontracting_receipt": doc.name},
		pluck="name",
	)
	if not pr_names:
		return

	# Build SR item lookup
	sr_item_by_name = {}
	for row in doc.get("items"):
		sr_item_by_name[row.name] = {
			"item_code": row.item_code,
			"item_name": row.item_name,
		}
	
	sr_item_codes = {row["item_code"] for row in sr_item_by_name.values()}
	
	# Build item name lookup from SR items
	item_name_by_code = {}
	for row in sr_item_by_name.values():
		if row.get("item_code"):
			item_name_by_code[row["item_code"]] = row["item_name"]

	po_item_names = set()
	for pr_name in pr_names:
		pr = frappe.get_doc("Purchase Receipt", pr_name)
		for row in pr.get("items"):
			if row.purchase_order_item:
				po_item_names.add(row.purchase_order_item)

	# Get PO items - extract clean item code from concatenated "Code: Name" format
	po_fg_item_by_name = {}
	if po_item_names:
		po_items = frappe.get_all(
			"Purchase Order Item",
			filters={"name": ["in", list(po_item_names)]},
			fields=["name", "fg_item"],
		)
		for row in po_items:
			raw_fg = row.fg_item or ""
			# FIX: Extract only the item code part before ": "
			if ": " in raw_fg:
				po_fg_item_by_name[row.name] = raw_fg.split(": ")[0]
			else:
				po_fg_item_by_name[row.name] = raw_fg

	# Fetch missing item names from Item master
	missing_codes = set()
	for code in po_fg_item_by_name.values():
		if code and code not in item_name_by_code:
			missing_codes.add(code)
	
	if missing_codes:
		items = frappe.get_all(
			"Item",
			filters={"name": ["in", list(missing_codes)]},
			fields=["name", "item_name"],
		)
		for row in items:
			item_name_by_code[row.name] = row.item_name

	# Update Purchase Receipt Items
	for pr_name in pr_names:
		pr = frappe.get_doc("Purchase Receipt", pr_name)
		
		for row in pr.get("items"):
			sr_item = sr_item_by_name.get(row.subcontracting_receipt_item) or {}
			fg_item = sr_item.get("item_code")
			fg_item_name = sr_item.get("item_name")

			# Fallback to PO item's fg_item (clean code)
			if not fg_item and row.purchase_order_item:
				fg_item = po_fg_item_by_name.get(row.purchase_order_item)
				fg_item_name = item_name_by_code.get(fg_item)

			if not (fg_item and (not sr_item_codes or fg_item in sr_item_codes)):
				continue

			values = {}
			if has_fg_item:
				values["fg_item"] = fg_item  # Now correctly stores "58258"
			if has_fg_item_name:
				values["fg_item_name"] = fg_item_name or item_name_by_code.get(fg_item)

			frappe.db.set_value(
				"Purchase Receipt Item",
				row.name,
				values,
				update_modified=False,
			)
   
def sync_supplier_delivery_note(doc, method=None):
	if not doc.get("supplier_delivery_note"):
		return

	pr_names = frappe.get_all(
		"Purchase Receipt",
		filters={"subcontracting_receipt": doc.name},
		pluck="name",
	)

	for pr_name in pr_names:
		frappe.db.set_value(
			"Purchase Receipt",
			pr_name,
			"supplier_delivery_note",
			doc.supplier_delivery_note,
			update_modified=False,
		)
  
def auto_submit_purchase_receipt(doc, method):
    """
    Core ERPNext's auto_create_purchase_receipt() creates the Purchase Receipt
    in Draft (save=True only, no submit). This hook runs after core's on_submit
    and auto-submits that Purchase Receipt.
    """
    if not frappe.db.get_single_value("Buying Settings", "auto_create_purchase_receipt"):
        return

    pr_name = frappe.db.get_value(
        "Purchase Receipt",
        {"subcontracting_receipt": doc.name, "docstatus": 0},
        "name"
    )

    if not pr_name:
        return

    pr_doc = frappe.get_doc("Purchase Receipt", pr_name)

    if frappe.has_permission(pr_doc.doctype, "submit", pr_doc):
        try:
            pr_doc.submit()
        except Exception as e:
            frappe.msgprint(
                _("Purchase Receipt {0} was created but could not be auto-submitted: {1}").format(
                    get_link_to_form(pr_doc.doctype, pr_doc.name), str(e)
                ),
                title="Auto-Submit Failed",
                indicator="orange"
            )
            
# jasma/jasma/doc_events/subcontracting_receipt.py

import frappe
from frappe.utils import flt


def fix_supplied_qty_before_submit(doc, method=None):
	"""
	Guard against the core supplied_qty clamp silently zeroing consumed_qty:
	set_consumed_qty_in_subcontract_order() does
	`if row.supplied_qty < consumed_qty: consumed_qty = row.supplied_qty`.

	For each supplied_items row on this receipt:
	1. If supplied_qty on the linked Subcontracting Order Supplied Item is
	   less than (or equal to) this receipt's consumed_qty, bump supplied_qty
	   up so the core clamp doesn't truncate it on submit.
	2. Also increments consumed_qty on that same Order Supplied Item row,
	   so it reflects this receipt's consumption immediately.

	Matches the Order Supplied Item row via (rm_item_code, main_item_code,
	subcontracting_order) — same composite key the core controller uses in
	__update_consumed_qty_in_subcontract_order, since Subcontracting Receipt
	Supplied Item rows have no direct link field to the order's row.

	hooks.py:
	doc_events = {
		"Subcontracting Receipt": {
			"before_submit": "jasma.jasma.doc_events.subcontracting_receipt.fix_supplied_qty_before_submit",
			"on_cancel": "jasma.jasma.doc_events.subcontracting_receipt.revert_supplied_qty_on_cancel",
		}
	}
	"""
	for row in doc.get("supplied_items", []):
		if not row.get("subcontracting_order") or not row.get("consumed_qty"):
			continue

		order_row = frappe.db.get_value(
			"Subcontracting Order Supplied Item",
			{
				"parent": row.subcontracting_order,
				"rm_item_code": row.rm_item_code,
				"main_item_code": row.main_item_code,
			},
			["name", "supplied_qty", "consumed_qty"],
			as_dict=True,
		)

		if not order_row:
			continue

		supplied_qty = flt(order_row.supplied_qty)
		consumed_qty = flt(order_row.consumed_qty)
		row_consumed_qty = flt(row.consumed_qty)

		if supplied_qty <= row_consumed_qty:
			frappe.db.set_value(
				"Subcontracting Order Supplied Item",
				order_row.name,
				"supplied_qty",
				supplied_qty + row_consumed_qty,
				update_modified=False,
			)

		frappe.db.set_value(
			"Subcontracting Order Supplied Item",
			order_row.name,
			"consumed_qty",
			consumed_qty + row_consumed_qty,
			update_modified=False,
		)


def revert_supplied_qty_on_cancel(doc, method=None):
	"""
	Mirror of fix_supplied_qty_before_submit — when this receipt is
	cancelled, subtract back what it had added to consumed_qty and
	supplied_qty on the linked Subcontracting Order Supplied Item,
	floored at 0 so it never goes negative.
	"""
	for row in doc.get("supplied_items", []):
		if not row.get("subcontracting_order") or not row.get("consumed_qty"):
			continue

		order_row = frappe.db.get_value(
			"Subcontracting Order Supplied Item",
			{
				"parent": row.subcontracting_order,
				"rm_item_code": row.rm_item_code,
				"main_item_code": row.main_item_code,
			},
			["name", "supplied_qty", "consumed_qty"],
			as_dict=True,
		)

		if not order_row:
			continue

		supplied_qty = flt(order_row.supplied_qty)
		consumed_qty = flt(order_row.consumed_qty)
		row_consumed_qty = flt(row.consumed_qty)

		frappe.db.set_value(
			"Subcontracting Order Supplied Item",
			order_row.name,
			"supplied_qty",
			max(supplied_qty - row_consumed_qty, 0),
			update_modified=False,
		)

		frappe.db.set_value(
			"Subcontracting Order Supplied Item",
			order_row.name,
			"consumed_qty",
			max(consumed_qty - row_consumed_qty, 0),
			update_modified=False,
		)