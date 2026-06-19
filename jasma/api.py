import frappe
from frappe.utils import flt

def update_balance(employee_advance):
    if not employee_advance:
        return

    doc = frappe.get_doc("Employee Advance", employee_advance)

    balance_amount = (
        flt(doc.paid_amount)
        - flt(doc.claimed_amount)
        - flt(doc.return_amount)
    )

    doc.db_set(
        "balance_amount",
        balance_amount,
        update_modified=False
    )


def update_employee_advance_balance(doc, method=None):

    # Expense Claim
    if doc.doctype == "Expense Claim":
        for row in doc.get("advances", []):
            update_balance(row.employee_advance)

    # Payment Entry
    elif doc.doctype == "Payment Entry":
        for row in doc.get("references", []):
            if row.reference_doctype == "Employee Advance":
                update_balance(row.reference_name)

    # Journal Entry
    elif doc.doctype == "Journal Entry":
        for row in doc.get("accounts", []):
            if row.reference_type == "Employee Advance":
                update_balance(row.reference_name)