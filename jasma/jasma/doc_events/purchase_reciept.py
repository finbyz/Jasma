import frappe
from frappe.model.mapper import get_mapped_doc
import json
from erpnext.stock.doctype.purchase_receipt.purchase_receipt import make_purchase_invoice


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




@frappe.whitelist()
def make_qc_report(docname, items):
	if isinstance(items, str):
		items = json.loads(items)
	# frappe.throw(str(items))
	reports = []
	skipped_items = []

	for item in items:

		existing = frappe.db.exists(
			"QC Report",
			{
				"reference_type": "Purchase Receipt",
				"reference_name": docname,
				"reference_item": item.get("docname")
			}
		)

		

		item_doc = frappe.get_doc("Item", item.get("item_code"))

		qc_report = frappe.get_doc({
			"doctype": "QC Report",
			"reference_type": "Purchase Receipt",
			"reference_name": docname,
			"reference_item": item.get("docname"),
			"item_group": item_doc.item_group,
			"item": item.get("item_code"),
			"received_quantity":item.get("received_quantity"),
			"po_no":item.get("purchase_order"),
			"project":item.get("project"),

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
		FROM `tabPurchase Receipt Item` pri
		INNER JOIN `tabItem` i ON i.name = pri.item_code
		LEFT JOIN `tabQC Report` qr
			ON qr.reference_item = pri.name
			AND qr.reference_name = pri.parent
			AND qr.reference_type = 'Purchase Receipt'
			AND qr.docstatus = 1
		WHERE pri.parent = %s
		AND %s = 0
		AND EXISTS (
			SELECT 1
			FROM `tabQC Report Parameter` qrp
			WHERE qrp.parent = i.name
		)
		AND qr.name IS NULL
	""", (self.name, self.is_return), as_dict=True)

	if missing_items:
		items = ", ".join([d.item_code for d in missing_items])

		frappe.throw(
			f"QC Report must be Created for items: <b>{items}</b>"
		)
  
def on_submit(self, method=None):
	create_purchase_invoice_on_submit(self)
  
def create_purchase_invoice_on_submit(doc, method=None):
    
    
    # Check Buying Settings
    if not frappe.db.get_single_value(
        "Buying Settings",
        "auto_generate_purchase_invoice_on_purchase_receipt_submission"
    ):
        return
    
    # Prevent duplicate invoices
    existing_pi = frappe.db.exists(
        "Purchase Invoice Item",
        {
            "purchase_receipt": doc.name,
            "docstatus": ["!=", 2]
        }
    )

    if existing_pi:
        return

    # Create Purchase Invoice from Purchase Receipt
    pi = make_purchase_invoice(doc.name)

    # Optional: set posting date same as Purchase Receipt
    pi.posting_date = doc.posting_date
    pi.bill_date = doc.posting_date
    # pi.bill_no = doc.name  # You can set the bill number to the Purchase Receipt name or any other logic
    pi.flags.ignore_validate = True
    pi.insert(
		ignore_permissions=True,
	)

    frappe.msgprint(f"Purchase Invoice {pi.name} created.")