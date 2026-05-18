import frappe

# def create_mr_on_submit(doc, method):

#     #  Condition
#     if doc.get_items_from != "Material Request":
#         return

#     # Reload full doc (important)
#     pp = frappe.get_doc("Production Plan", doc.name)

#     #  Call standard method
#     mr_list = pp.make_material_request()

#     if not mr_list:
#         return

#     draft_mrs = []

#     for mr_name in mr_list:
#         mr = frappe.get_doc("Material Request", mr_name)

#         #  Convert to Draft using copy
#         new_mr = frappe.copy_doc(mr)
#         new_mr.docstatus = 0
#         new_mr.insert(ignore_permissions=True)

#         draft_mrs.append(new_mr.name)

#     frappe.msgprint(f"Draft Material Request Created: {', '.join(draft_mrs)}")

@frappe.whitelist()
def set_submit_flag(value):
    frappe.flags.submit_mr = int(value)

def create_mr_on_submit(doc, method):

    if doc.get_items_from != "Material Request":
        return

    pp = frappe.get_doc("Production Plan", doc.name)

    submit_mr = getattr(frappe.flags, "submit_mr", 0)

    # Control standard behavior
    if hasattr(pp, "submit_material_request"):
        pp.submit_material_request = submit_mr

    # Create MR
    pp.make_material_request()

    status = "Submitted" if submit_mr else "Draft"
    update_pp_reference(doc)
    frappe.msgprint(f"Material Request Created ({status})")
    
    
def update_pp_reference(doc):

    if doc.get_items_from != "Material Request":
        return

    for row in doc.po_items:

        if row.material_request_item:

            frappe.db.set_value(
                "Material Request Item",
                row.material_request_item,
                "pp_reference",
                doc.name,
                update_modified=False
            )
            
            
def before_cancel(doc, method):
    for item in doc.po_items:
        mr_item_doc = frappe.get_doc("Material Request Item", item.material_request_item)
        mr_item_doc.db_set("pp_reference", "")