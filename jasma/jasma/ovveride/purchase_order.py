import frappe
from erpnext.buying.doctype.purchase_order.purchase_order import PurchaseOrder
from erpnext.buying import utils as buying_utils


def _bypass_validate_stock_item_warehouse(row, item) -> None:
    """Warehouse validation bypassed because delivery_terms is set on this PO."""
    # frappe.log_error("Warehouse validation bypassed because delivery_terms is set on this PO")
    return  


class CustomPurchaseOrder(PurchaseOrder):

    def validate(self):
        original_fn = buying_utils.validate_stock_item_warehouse  

        if self.get("delivery_terms"):
            buying_utils.validate_stock_item_warehouse = _bypass_validate_stock_item_warehouse

        try:
            super().validate()
        finally:
            
            buying_utils.validate_stock_item_warehouse = original_fn