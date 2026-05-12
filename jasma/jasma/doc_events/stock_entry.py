import frappe
import json


def validate_qc_report(self, method=None):

	# Only for Manufacture Stock Entry
	if self.stock_entry_type != "Manufacture":
		return

	missing_items = frappe.db.sql("""
		SELECT sed.item_code
		FROM `tabStock Entry Detail` sed
		INNER JOIN `tabItem` i ON i.name = sed.item_code

		LEFT JOIN `tabQC Report` qr
			ON qr.reference_item = sed.name
			AND qr.reference_name = sed.parent
			AND qr.reference_type = 'Stock Entry'
			AND qr.docstatus = 1

		WHERE sed.parent = %s

		-- Target Warehouse must be set
		AND IFNULL(sed.t_warehouse, '') != ''

		-- QC Parameters available in Item master
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
			f"QC Report must be Created for Items: <b>{items}</b>"
		)
  
  

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
				"reference_type": "Stock Entry",
				"reference_name": docname,
				"reference_item": item.get("docname")
			}
		)

		

		item_doc = frappe.get_doc("Item", item.get("item_code"))

		qc_report = frappe.get_doc({
			"doctype": "QC Report",
			"reference_type": "Stock Entry",
			"reference_name": docname,
			"reference_item": item.get("docname"),
			"item_group": item_doc.item_group,
			"item": item.get("item_code"),
			"received_quantity":item.get("qty"),
			"po_no":item.get("purchase_order"),
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