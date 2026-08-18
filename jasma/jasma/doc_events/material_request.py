import frappe
from frappe.utils import nowdate, getdate
from frappe import _


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



# @frappe.whitelist()
# def create_production_plan_from_mr(material_request):
#     mr = frappe.get_doc("Material Request", material_request)

#     #  Check BOM items
#     items = []
#     for row in mr.items:
#         if row.bom_no:
#             items.append({
#                 "item_code": row.item_code,
#                 "bom_no": row.bom_no,
#                 "planned_qty": row.qty,
#                 "material_request_item": row.name,
#                 "warehouse":row.warehouse
#             })

#     if not items:
#         frappe.throw("No items with BOM found")

#     #  Check if already exists
#     existing = frappe.get_all(
#         "Production Plan Item",
#         filters={"material_request_item": ["in", [i["material_request_item"] for i in items]]},
#         limit=1
#     )

#     if existing:
#         frappe.throw("Production Plan already exists for this Material Request")

#     return {
#         "get_items_from": "Material Request",
#         "material_request": material_request,
#         "po_items": items   # pass data to JS
#     }


@frappe.whitelist()
def create_production_plan_from_mr(material_request):
    mr = frappe.get_doc("Material Request", material_request)

    items = []

    for row in mr.items:

        # Skip if no BOM
        if not row.bom_no:
            continue

        # Skip if already linked
        if row.pp_reference:
            continue

        items.append({
            "item_code": row.item_code,
            "bom_no": row.bom_no,
            "planned_qty": row.qty,
            "material_request_item": row.name,
            "warehouse": row.warehouse,
            "mr_item_name": row.name
        })

    if not items:
        frappe.throw("All BOM items already linked with Production Plan")

    return {
        "get_items_from": "Material Request",
        "material_request": material_request,
        "po_items": items
    }


@frappe.whitelist()
def get_production_plan_items(mr_items):
    if isinstance(mr_items, str):
        mr_items = frappe.parse_json(mr_items)

    return frappe.get_all(
        "Production Plan Item",
        filters={
            "material_request_item": ["in", mr_items]
        },
        fields=["parent", "docstatus"],
        limit_page_length=50,
        ignore_permissions=True
    )

def update_mr_pp_reference(doc, method):

    for row in doc.po_items:

        if not row.material_request_item:
            continue

        frappe.db.set_value(
            "Material Request Item",
            row.material_request_item,
            {
                "pp_reference": doc.name
            }
        )
        
import frappe

def validate(doc, method):
    fetch_stock_qty(doc)

def fetch_stock_qty(doc):
    for item in doc.items:

        if not item.item_code:
            continue

        # Total stock across all warehouses
        total_stock_all_warehouses = frappe.db.sql("""
            SELECT COALESCE(SUM(actual_qty), 0)
            FROM `tabBin`
            WHERE item_code = %s
        """, (item.item_code,))[0][0]

        item.total_stock_all_warehouses = total_stock_all_warehouses or 0



@frappe.whitelist()
def mark_material_request_shipped(material_request):
    """
    Set a submitted, Stopped Material Request's status to 'Shipped'.
    Uses db_set (bypasses the doc's normal status-recompute logic, which
    is driven off % Ordered/% Received) since Shipped is a custom
    terminal status layered on top of the standard ones.
    """
    doc = frappe.get_doc("Material Request", material_request)

    if doc.docstatus != 1:
        frappe.throw(_("Only submitted Material Requests can be marked as Shipped."))

    if doc.status != "Stopped":
        frappe.throw(_("Only Material Requests with status 'Stopped' can be marked as Shipped."))

    doc.db_set("status", "Shipped", update_modified=True)
    return {"status": "Shipped"}


@frappe.whitelist(allow_guest=False)
def preserve_shipped_status_on_load(doc, method=None):
    """
    ERPNext's own MaterialRequest.onload() calls set_status(update=False),
    which recomputes `status` in-memory from per_ordered/per_received on
    every single load - silently discarding our custom 'Shipped' status
    (since 'Shipped' isn't a state that computation knows about), even
    though it's still correctly saved in the database. This hook runs
    immediately after that recompute (see hooks.py doc_events) and
    restores the persisted 'Shipped' value so the form actually shows it.
    """
    if doc.docstatus != 1:
        return

    db_status = frappe.db.get_value("Material Request", doc.name, "status")
    if db_status == "Shipped":
        doc.status = "Shipped"