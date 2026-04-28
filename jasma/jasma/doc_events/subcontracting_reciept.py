import frappe
import json

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