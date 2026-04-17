import frappe
from frappe.utils import nowdate, getdate

@frappe.whitelist()
def create_manufacture_mr(source_mr):
    source_doc = frappe.get_doc("Material Request", source_mr)

    new_mr = frappe.new_doc("Material Request")

    # Copy header fields
    new_mr.company = source_doc.company
    new_mr.set_warehouse = source_doc.set_warehouse

    #  Fix schedule date (if old → today)
    today = getdate(nowdate())
    source_schedule_date = getdate(source_doc.schedule_date) if source_doc.schedule_date else today

    new_mr.schedule_date = today if source_schedule_date < today else source_schedule_date

    # Set type
    new_mr.material_request_type = "Manufacture"

    has_bom_item = False  # track items

    for item in source_doc.items:
        bom = frappe.db.get_value(
            "BOM",
            {"item": item.item_code, "is_active": 1, "is_default": 1},
            "name"
        )

        if bom:
            has_bom_item = True

            #  Fix item schedule date 
            item_schedule_date = getdate(item.schedule_date) if item.schedule_date else today
            final_date = today if item_schedule_date < today else item_schedule_date

            new_item = new_mr.append("items", {})
            new_item.item_code = item.item_code
            new_item.qty = item.qty
            new_item.schedule_date = final_date
            new_item.warehouse = item.warehouse
            new_item.bom_no = bom

    if not has_bom_item:
        frappe.throw("Item Have not BOM Selected")

    # Save Draft
    new_mr.insert(ignore_permissions=True)

    return new_mr.name




