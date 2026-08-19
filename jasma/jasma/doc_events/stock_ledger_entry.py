import frappe
from frappe.utils import flt


def update_item_last_valuation_rate(doc, method):
    """Hook: Stock Ledger Entry -> on_update / on_cancel"""

    if not frappe.db.get_single_value("Stock Settings", "auto_update_item_last_valuation_rate"):
        return

    if not doc.item_code:
        return

    recalculate_last_valuation_rate(doc.item_code)
    
@frappe.whitelist()
def recalculate_last_valuation_rate(item_code):
    frappe.logger().info(f"Recalculating last_valuation_rate for {item_code}")

    bins = frappe.get_all(
        "Bin",
        filters={"item_code": item_code},
        fields=["actual_qty", "valuation_rate"]
    )

    total_rate = 0.0
    bin_count = 0

    for row in bins:
        total_rate += flt(row.valuation_rate)
        bin_count += 1

    weighted_avg_rate = flt(total_rate / bin_count, 6) if bin_count else 0.0
    current_rate = flt(frappe.db.get_value("Item", item_code, "last_valuation_rate"), 6)

    frappe.logger().info(f"{item_code}: current={current_rate}, new={weighted_avg_rate}")

    if current_rate != weighted_avg_rate:
        frappe.db.set_value(
            "Item",
            item_code,
            "last_valuation_rate",
            weighted_avg_rate,
            update_modified=False
        )
        
        
        
@frappe.whitelist()
def recalculate_all_items_last_valuation_rate():
    items = frappe.get_all("Item", pluck="name")
    total = len(items)
    frappe.logger().info(f"Starting last_valuation_rate recalculation for {total} items")

    updated = 0
    failed = 0

    for idx, item_code in enumerate(items, start=1):
        try:
            recalculate_last_valuation_rate(item_code)
            updated += 1
        except Exception:
            failed += 1
            frappe.log_error(
                frappe.get_traceback(),
                f"recalculate_last_valuation_rate failed for {item_code}"
            )

        if idx % 100 == 0:
            print(f"Processed {idx}/{total} items...")

    print(f"Done. Updated: {updated}, Failed: {failed}, Total: {total}")