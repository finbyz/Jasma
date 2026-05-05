import frappe
import json

# def validate_qc_report(self, method=None):
#     missing_items = frappe.db.sql("""
#         SELECT sri.item_code
#         FROM `tabSubcontracting Receipt Item` sri
#         INNER JOIN `tabItem` i ON i.name = sri.item_code
#         LEFT JOIN `tabQuality Inspection` qi
#             ON qi.reference_name = sri.parent
#             AND qi.reference_type = 'Subcontracting Receipt'
#             AND qi.item_code = sri.item_code
#             AND qi.docstatus = 1
#         WHERE sri.parent = %s
#         AND qi.name IS NULL
#     """, self.name, as_dict=True)

#     # ✅ Log the missing items (for debugging)
#     if missing_items:
#         frappe.log_error(
#             title="Missing Quality Inspection Items",
#             message=json.dumps(missing_items, indent=2)
#         )

#         items = ", ".join([d.item_code for d in missing_items])

#         frappe.throw(
#             f"Quality Inspection must be submitted for items: <b>{items}</b>"
#         )


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