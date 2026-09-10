# your_app/overrides/sales_order.py

import frappe
from frappe import _
from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice as _make_sales_invoice


@frappe.whitelist()
def make_sales_invoice(source_name, target_doc=None, ignore_permissions=False):
    # Run the standard ERPNext mapping first (items, taxes, etc.)
    target_doc = _make_sales_invoice(
        source_name, target_doc=target_doc, ignore_permissions=ignore_permissions
    )

    source_doc = frappe.get_doc("Sales Order", source_name)

    if source_doc.get("commercial_item"):
        # Clear any commercial_item rows the base mapper might have left (usually none)
        target_doc.set("commercial_item", [])

        for row in source_doc.commercial_item:
            target_doc.append("commercial_item", {
                "commercial_item_code": row.commercial_item_code,
                "commercial_item_name": row.commercial_item_name,
                "description": row.description,
                "quantity": row.quantity,
                "rate": row.rate,
                "amount": row.amount,
            })

    return target_doc