import frappe
from frappe import _
from frappe.utils import comma_or, flt

def before_submit(self, method):
    if self.is_subcontracted:
        for row in self.items:
            if row.material_request_item:
                frappe.db.set_value("Material Request Item",row.material_request_item ,"has_subcontracting", 1)
                frappe.db.set_value("Material Request",row.material_request ,"status", "Partially Ordered")
                mr_doc = frappe.get_doc("Material Request", row.material_request)

                all_items_ordered = True
                pending_items = []

                for mr_row in mr_doc.items:

                    # Condition 1:
                    # Normal PO qty not fully ordered
                    if flt(mr_row.ordered_qty) < flt(mr_row.qty):
                        all_items_ordered = False

                        pending_items.append({
                            "item_code": mr_row.item_code,
                            "reason": "PO Pending",
                            "required_qty": mr_row.qty,
                            "ordered_qty": mr_row.ordered_qty
                        })

                    # Condition 2:
                    # Subcontracting required but SO not created
                    elif mr_row.get("has_subcontracting") and not mr_row.get("subcontracting_order"):
                        all_items_ordered = False

                        pending_items.append({
                            "item_code": mr_row.item_code,
                            "reason": "Subcontracting Order Pending"
                        })

                if all_items_ordered:
                    frappe.db.set_value("Material Request", row.material_request, "status", "Ordered")
                else:
                    frappe.db.set_value("Material Request", row.material_request, "status", "Partially Ordered")
                    if mr_doc.per_ordered >= 100:
                        frappe.db.set_value("Material Request", row.material_request, "per_ordered", 99.99)


def validate_delivery_schedule_qty(self,method):
    if not self.get("delivery_schedule"):
        return

    ordered_qty_map = {}
    for item in self.get("items"):
        ordered_qty_map[item.item_code] = (
            ordered_qty_map.get(item.item_code, 0) + item.qty
        )

    invalid_items = []

    for row in self.get("delivery_schedule"):
        item_code = row.item_code
        delivery_qty = row.get("qty") or 0
        ordered_qty = ordered_qty_map.get(item_code, 0)

        if delivery_qty > ordered_qty:
            row.qty = 0

            
            invalid_items.append(
                f"For Item {item_code}: Delivery Qty cannot be greater than Ordered Qty. (Entered: {delivery_qty}, Allowed: {ordered_qty})"
            )

    if invalid_items:
        # frappe.throw(
        #     _("Delivery Qty for following items cannot be greater than Ordered Qty.<br><br>{0}").format(
        #         "<br>".join(invalid_items)
        #     )
        # )
        frappe.msgprint(
            _("Delivery Qty for following items was reset to 0:<br><br>{0}").format(
                "<br>".join(invalid_items)
            ),
            title=_("Delivery Qty Adjusted"),
            indicator="orange"
        )
