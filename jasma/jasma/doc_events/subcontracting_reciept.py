import frappe
import json
# import flt
from erpnext.subcontracting.doctype.subcontracting_receipt.subcontracting_receipt import SubcontractingReceipt

def validate_qc_report(self, method=None):
    SubcontractingReceipt.validate_available_qty_for_consumption(self)




@frappe.whitelist()
def make_qc_report(docname, items):
	if isinstance(items, str):
		items = json.loads(items)
	reports = []
	skipped_items = []

	for item in items:

		existing = frappe.db.exists(
			"QC Report",
			{
				"reference_type": "Subcontracting Receipt",
				"reference_name": docname,
				"reference_item": item.get("docname")
			}
		)

		

		item_doc = frappe.get_doc("Item", item.get("item_code"))

		qc_report = frappe.get_doc({
			"doctype": "QC Report",
			"reference_type": "Subcontracting Receipt",
			"reference_name": docname,
			"reference_item": item.get("docname"),
			"item_group": item_doc.item_group,
			"item": item.get("item_code"),
			"received_quantity":item.get("received_quantity"),
			"po_no":item.get("purchase_order"),
			"so_no":item.get("subcontracting_order"),
			"project":item.get("project")
		})

		if existing:
			skipped_items.append(qc_report.get("item"))
			frappe.throw(f"QC Report already created for Item {skipped_items}")

		for row in item_doc.qc_report_parameter:
			qc_report.append("qc_report_parameter", {
				"description": row.description,
				# "status": row.status,
				"jasma_report_check":row.jasma_report_check,
				"vendor_report_check":row.vendor_report_check,
				"third_party_report_check":row.third_party_report_check
			})

		qc_report.insert(ignore_permissions=True)
		reports.append(qc_report.name)

	return reports


def validate_qc_report(self, method=None):
	missing_items = frappe.db.sql("""
		SELECT pri.item_code
		FROM `tabSubcontracting Receipt Item` pri
		INNER JOIN `tabItem` i ON i.name = pri.item_code
		LEFT JOIN `tabQC Report` qr
			ON qr.reference_item = pri.name
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