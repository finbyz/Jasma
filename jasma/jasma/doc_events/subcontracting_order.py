import frappe
from frappe.utils import comma_or, flt

def before_submit(self, method):
    for row in self.items:
        if not row.purchase_order_item:
            continue
        mr_item = frappe.db.get_value("Purchase Order Item",row.purchase_order_item, "material_request_item")
        if mr_item:
            frappe.db.set_value("Material Request Item", mr_item, "subcontracting_order", self.name)
        mr = frappe.db.get_value("Purchase Order Item",row.purchase_order_item, "material_request")
        if not mr:
            continue
        mr_doc = frappe.get_doc("Material Request", mr)

        all_items_ordered = True
        pending_items = []

        for row in mr_doc.items:

            # Condition 1:
            # Normal PO qty not fully ordered
            if flt(row.ordered_qty) < flt(row.qty):
                all_items_ordered = False

                pending_items.append({
                    "item_code": row.item_code,
                    "reason": "PO Pending",
                    "required_qty": row.qty,
                    "ordered_qty": row.ordered_qty
                })

            # Condition 2:
            # Subcontracting required but SO not created
            elif row.get("has_subcontracting") and not row.get("subcontracting_order"):
                all_items_ordered = False

                pending_items.append({
                    "item_code": row.item_code,
                    "reason": "Subcontracting Order Pending"
                })

        if all_items_ordered:
            frappe.db.set_value("Material Request", mr, "status", "Ordered")
            frappe.db.set_value("Material Request", mr, "per_ordered", 100)
        else:
            frappe.db.set_value("Material Request", mr, "status", "Partially Ordered")
            if mr_doc.per_ordered >= 100:
                frappe.db.set_value("Material Request", mr, "per_ordered", 99.99)
                

def on_cancel(doc, method):
    for item in doc.items:
        if not item.material_request_item:
            continue

        # Clear in Material Request Item
        mr_item = frappe.get_doc(
            "Material Request Item",
            item.material_request_item
        )

        mr_item.subcontracting_order = ""
        mr_item.db_update()

        # Clear in parent Material Request
        mr = frappe.get_doc(
            "Material Request",
            mr_item.parent
        )

        mr.subcontracting_order = ""
        mr.db_update()


