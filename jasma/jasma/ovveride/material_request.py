



from erpnext.selling.doctype.sales_order.sales_order import get_requested_item_qty
import frappe
from frappe.utils import (
	add_days
    )
from frappe import _, qb
from frappe.model.mapper import get_mapped_doc


from erpnext.stock.get_item_details import (
	ItemDetailsCtx,
	get_bin_details,
	get_price_list_rate,
)


from frappe.utils import flt
from erpnext.stock.doctype.material_request.material_request import MaterialRequest


class CustomMaterialRequest(MaterialRequest):

    def get_status(self):
        # get standard status first
        status = super().get_status()

        # skip if not valid
        if self.docstatus != 1 or self.status == "Stopped":
            return status

        # -----------------------------
        # 🔍 CHECK SUBCONTRACT PO EXISTS
        # -----------------------------
        po_list = frappe.get_all(
            "Purchase Order Item",
            filters={"material_request": self.name},
            pluck="parent"
        )

        subcontract_exists = False

        if po_list:
            subcontract_exists = frappe.db.exists(
                "Purchase Order",
                {
                    "name": ["in", po_list],
                    "is_subcontracted": 1
                }
            )

        # -----------------------------
        # ✅ ORDERED
        # -----------------------------
        if (
            flt(self.per_ordered) == 100
            and subcontract_exists
            and self.material_request_type in ["Purchase", "Manufacture", "Subcontracting"]
        ):
            return {"status": "Ordered"}

        # -----------------------------
        # ✅ PARTIALLY ORDERED
        # -----------------------------
        if (
            0 < flt(self.per_ordered) < 100
            and subcontract_exists
            and self.material_request_type not in ["Material Transfer", "Customer Provided"]
        ):
            return {"status": "Partially Ordered"}

        # -----------------------------
        # ✅ RECEIVED (with subcontract logic)
        # -----------------------------
        if (
            subcontract_exists
            and flt(self.per_received) == 100
            and self.material_request_type == "Purchase"
        ):
            return {"status": "Received"}

        # -----------------------------
        # fallback to standard
        # -----------------------------
        return status



@frappe.whitelist()
def make_material_request(source_name, target_doc=None):
    frappe.log_error("custom make_material_request called")
    requested_item_qty = get_requested_item_qty(source_name)

    def postprocess(source, target):
         #  Set Required By at root MR level = delivery_date - 7 days
        if source.get("delivery_date"):
            target.schedule_date = add_days(source.delivery_date, -7)
            
        if source.tc_name and frappe.db.get_value("Terms and Conditions", source.tc_name, "buying") != 1:
            target.tc_name = None
            target.terms = None

    def get_remaining_qty(so_item):
        return flt(
            flt(so_item.qty)
            - flt(requested_item_qty.get(so_item.name, {}).get("qty"))
            - max(
                flt(so_item.get("delivered_qty")),
                0,
            )
        )

    def get_remaining_packed_item_qty(so_item):
        delivered_qty = frappe.db.get_value(
            "Sales Order Item", {"name": so_item.parent_detail_docname}, ["delivered_qty"]
        )

        bundle_item_qty = frappe.db.get_value(
            "Product Bundle Item", {"parent": so_item.parent_item, "item_code": so_item.item_code}, ["qty"]
        )

        return flt(
            flt(so_item.qty)
            - flt(requested_item_qty.get(so_item.name, {}).get("qty"))
            - max(
                flt(delivered_qty) * flt(bundle_item_qty),
                0,
            )
        )

    def update_item(source, target, source_parent):
        # qty is for packed items, because packed items don't have stock_qty field
        target.project = source_parent.project
        
        target.qty = (
            get_remaining_packed_item_qty(source)
            if source.parentfield == "packed_items"
            else get_remaining_qty(source)
        )
        target.stock_qty = flt(target.qty) * flt(target.conversion_factor)
        target.actual_qty = get_bin_details(
            target.item_code, target.warehouse, source_parent.company, True
        ).get("actual_qty", 0)

         #  Set item-level schedule_date — this drives the header date on save
        if source.get("delivery_date"):
            target.schedule_date = add_days(source.get("delivery_date"), -7)

         

        ctx = ItemDetailsCtx(target.as_dict().copy())
        ctx.update(
            {
                "company": source_parent.get("company"),
                "price_list": frappe.db.get_single_value("Buying Settings", "buying_price_list"),
                "currency": source_parent.get("currency"),
                "conversion_rate": source_parent.get("conversion_rate"),
            }
        )

        target.rate = flt(
            get_price_list_rate(ctx, item_doc=frappe.get_cached_doc("Item", target.item_code)).get(
                "price_list_rate"
            )
        )
        target.amount = target.qty * target.rate
    delivery_date=frappe.db.get_value("Sales Order", source_name, "delivery_date")
    back_schedule_date=add_days(delivery_date, -7)
    doc = get_mapped_doc(
        "Sales Order",
        source_name,
        {
            "Sales Order": {"doctype": "Material Request",
            
             "validation": {"docstatus": ["=", 1]}},
            "Packed Item": {
                "doctype": "Material Request Item",
                "field_map": {"parent": "sales_order", "uom": "stock_uom", "name": "packed_item"},
                "condition": lambda item: get_remaining_packed_item_qty(item) > 0,
                "postprocess": update_item,
            },
            
            "Sales Order Item": {
                "doctype": "Material Request Item",
                "field_map": {
                    "name": "sales_order_item",
                    "parent": "sales_order",
                    "delivery_date": "schedule_date",

                    "bom_no": "bom_no",
                },
                "condition": lambda item: not frappe.db.exists(
                    "Product Bundle", {"name": item.item_code, "disabled": 0}
                )
                and get_remaining_qty(item) > 0,
                "postprocess": update_item,
            },
        },
        target_doc,
        postprocess,
    )
    if doc and doc.items:
        return doc
    else:
        frappe.throw(_("Material Request already created for the ordered quantity"))
