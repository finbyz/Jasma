import frappe


def update_supplier_bank_account(doc, method=None):
    # Only proceed if this is set as the default bank account
    if not doc.is_default:
        return

    if doc.party_type == "Supplier" and doc.party:
        frappe.db.set_value(
            "Supplier",
            doc.party,
            "bank_acccount",  # existing field name (typo retained as-is in Supplier doctype)
            doc.name
        )

    elif doc.party_type == "Customer" and doc.party:
        frappe.db.set_value(
            "Customer",
            doc.party,
            "default_customer_bank_account",
            doc.name
        )