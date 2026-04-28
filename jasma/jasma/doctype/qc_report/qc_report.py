# Copyright (c) 2026, Finbyz tech and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


# @frappe.whitelist()
# def create_non_conformance(docname):
# 	qc = frappe.get_doc("QC Report", docname)
 
# 	existing_nc = frappe.db.exists("Non - Conformance", {
# 		"qc_report": qc.name,
# 		"docstatus": ["!=", 2]
# 	})

# 	if existing_nc:
# 		frappe.throw("Non Conformance already created for this QC Report")

# 	nc = frappe.new_doc("Non - Conformance")

# 	nc.grn_no = qc.reference_name
# 	nc.qc_report = qc.name

# 	if qc.item:
# 		item = frappe.get_doc("Item", qc.item)

# 		nc.product_name = item.name
# 		nc.jasma_part_code = item.item_code
# 		nc.product_drawing_no = item.drawing_1
# 		nc.ao_reference_no = item.aopo_reference

# 	if qc.reference_type == "Purchase Receipt":
# 		pr = frappe.get_doc("Purchase Receipt", qc.reference_name)

# 		nc.grn_date = pr.posting_date
# 		nc.supplier = pr.supplier
  
# 		for row in pr.items:
# 			if row.item_code == qc.item:
# 				nc.po_reference_no = row.purchase_order
# 				nc.warehouse = row.warehouse
# 				break

# 	nc.insert(ignore_permissions=True)

# 	return nc.name

@frappe.whitelist()
def get_nc_data(docname):
    qc = frappe.get_doc("QC Report", docname)

    #  Only check existence (optional)
    existing_nc = frappe.db.exists("Non - Conformance", {
        "qc_report": qc.name,
        "docstatus": ["!=", 2]
    })

    if existing_nc:
        frappe.throw("Non Conformance already created for this QC Report")

    #  Prepare data ONLY (no insert)
    data = {
        "qc_report": qc.name,
        "grn_no": qc.reference_name
    }

    if qc.item:
        item = frappe.get_doc("Item", qc.item)

        data.update({
            "product_name": item.name,
            "jasma_part_code": item.item_code,
            "product_drawing_no": item.drawing_1,
            "ao_reference_no": item.aopo_reference
        })

    if qc.reference_type == "Purchase Receipt":
        pr = frappe.get_doc("Purchase Receipt", qc.reference_name)

        data.update({
            "grn_date": pr.posting_date,
            "supplier": pr.supplier
        })

        for row in pr.items:
            if row.item_code == qc.item:
                data.update({
                    "po_reference_no": row.purchase_order,
                    "warehouse": row.warehouse
                })
                break

    return data


class QCReport(Document):
	def on_submit(self):
		if not self.qc_report_parameter:
			return

		for row in self.qc_report_parameter:
			if not (
				row.jasma_report_check == 1
				or row.vendor_report_check == 1
				or row.third_party_report_check == 1
			):
				frappe.throw(
					f"Row #{row.idx}: Please select at least one checkbox (Jasma / Vendor / Third Party Report)."
				)


	