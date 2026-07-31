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
        
        
def validate(doc,method):
    validate_subcontracted_items(doc, method)

def on_submit(doc, method):
    auto_submit_subcontracting_order(doc, method)
    
def validate_subcontracted_items(doc, method):
    if doc.is_subcontracted:
        return

    flagged_items = []

    for row in doc.items:
        if not row.item_code:
            continue

        item = frappe.db.get_value(
            "Item",
            row.item_code,
            ["is_sub_contracted_item", "default_bom"],
            as_dict=True
        )

        if item and item.is_sub_contracted_item and item.default_bom:
            flagged_items.append(row.item_code)

    if flagged_items:
        frappe.throw(
            "Items <b>{0}</b> are Subcontracted Items with a Default BOM set.<br>"
            "Please either remove Item, "
            "or check <b>'Supply Raw Materials'</b> (Is Subcontracted) on this Purchase Order."
            .format(", ".join(flagged_items))
        )
        

def auto_submit_subcontracting_order(doc, method):
    if not doc.is_subcontracted:
        return

    if not frappe.db.get_single_value(
        "Buying Settings",
        "auto_submit_subcontracting_order_on_purchase_order_submission"
    ):
        return

    sco_list = frappe.get_all(
        "Subcontracting Order",
        filters={"purchase_order": doc.name, "docstatus": 0},
        pluck="name"
    )

    for sco_name in sco_list:
        sco = frappe.get_doc("Subcontracting Order", sco_name)
        sco.submit()
        


@frappe.whitelist()
def get_manufacturing_notes_summary(purchase_order):
    if not frappe.db.get_single_value("Buying Settings", "show_manufacturing_notes_popup_on_purchase_order_save"):
        return []

    po = frappe.get_doc("Purchase Order", purchase_order)

    notes_summary = []
    seen_items = set()

    for row in po.items:
        # Subcontracted PO -> use fg_item, else use item_code
        lookup_item = row.fg_item if po.is_subcontracted else row.item_code

        if not lookup_item or lookup_item in seen_items:
            continue
        seen_items.add(lookup_item)

        manufacturing_notes = frappe.db.get_value("Item", lookup_item, "manufacturing_notes")

        if lookup_item:
            notes_summary.append({
                "item_code": lookup_item,
                "manufacturing_notes": manufacturing_notes
            })

    return notes_summary
