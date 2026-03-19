import frappe
from frappe.model.mapper import get_mapped_doc

@frappe.whitelist()
def make_stock_entry_from_purchase_receipt(source_name, target_doc=None, args=None):
	def set_missing_values(source, target):
		target.purpose = "Material Transfer"

	doc = get_mapped_doc(
		"Purchase Receipt",
		source_name,
		{
			"Purchase Receipt": {
				"doctype": "Stock Entry",
				"validation": {"docstatus": ["=", 1]}
			},
			"Purchase Receipt Item": {
				"doctype": "Stock Entry Detail",
				"field_map": {
					"item_code": "item_code",
					"qty": "qty",
					"stock_qty": "transfer_qty",
				},
			},
		},
		target_doc,
		set_missing_values
	)

	return doc


import frappe
import json


@frappe.whitelist()
def make_qc_report(docname, items):
	if isinstance(items, str):
		items = json.loads(items)

	reports = []

	for item in items:

		existing = frappe.db.exists(
			"QC Report",
			{
				"purchase_receipt": docname,
				"purchase_receipt_item": item.get("docname")
			}
		)

		if existing:
			frappe.throw(f"QC Report already created for Item {item.get('item_code')}")

		item_doc = frappe.get_doc("Item", item.get("item_code"))

		qc_report = frappe.get_doc({
			"doctype": "QC Report",
			"purchase_receipt": docname,
			"purchase_receipt_item": item.get("docname"),
			"item_group": item_doc.item_group,
			"item": item.get("item_code")
		})

		for row in item_doc.qc_report_parameter:
			qc_report.append("qc_report_parameter", {
				"qc_report": row.qc_report,
				"length": row.length,
				"width": row.width,
				"capping": row.capping
			})

		qc_report.insert(ignore_permissions=True)
		reports.append(qc_report.name)

	return reports