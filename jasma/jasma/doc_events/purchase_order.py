import frappe
from frappe import _
from frappe.utils import comma_or, flt
from erpnext.utilities.transaction_base import TransactionBase

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
def get_manufacturing_notes_summary(items, is_subcontracted=0):
    if not frappe.db.get_single_value(
        "Buying Settings", "show_manufacturing_notes_popup_on_purchase_order_save"
    ):
        return []

    if isinstance(items, str):
        items = frappe.parse_json(items)

    is_subcontracted = frappe.utils.cint(is_subcontracted)

    notes_summary = []
    seen_items = set()

    for row in items:
        lookup_item = row.get("fg_item") if is_subcontracted else row.get("item_code")

        if not lookup_item or lookup_item in seen_items:
            continue
        seen_items.add(lookup_item)

        manufacturing_notes = frappe.db.get_value("Item", lookup_item, "manufacturing_notes")

        notes_summary.append({
            "item_code": lookup_item,
            "manufacturing_notes": manufacturing_notes
        })

    return notes_summary





import frappe
from erpnext.utilities.transaction_base import TransactionBase

# keep a reference to the original, unpatched method
_original_validate_with_previous_doc = TransactionBase.validate_with_previous_doc


def patched_validate_with_previous_doc(self, ref):
	"""
	Allow multiple Purchase Order Item rows to reference the same
	Material Request Item row (e.g. when the same MR item is split
	across suppliers, batches, or partial quantities) — but only
	when "Allow Duplicate Material Request Item Row in Purchase
	Order" is checked in Buying Settings.

	Core erpnext.utilities.transaction_base.TransactionBase.validate_with_previous_doc
	throws "Duplicate row {idx} with same {key}" whenever the same
	ref_dn repeats in a child table ref, unless allow_duplicate_prev_row_id
	is set. We force it True here, scoped only to Purchase Order +
	Material Request Item + the settings checkbox, so every other
	doctype/reference keeps the default strict behaviour, and this
	one can be toggled off without a code change.

	Sales Invoice and Delivery Note are explicitly skipped entirely —
	validate_with_previous_doc does not run at all for these doctypes,
	so none of the compare_fields checks (customer, company, project,
	currency, item_code, uom, etc.) against the previous document are
	enforced.
	"""
	if self.doctype in ("Sales Invoice", "Delivery Note"):
		return

	if self.doctype == "Purchase Order" and frappe.db.get_single_value(
		"Buying Settings", "allow_duplicate_material_request_item_row_in_purchase_order"
	):
		for key, val in ref.items():
			if val.get("is_child_table") and key == "Material Request Item":
				val["allow_duplicate_prev_row_id"] = True

	return _original_validate_with_previous_doc(self, ref)


def apply_patch():
	TransactionBase.validate_with_previous_doc = patched_validate_with_previous_doc