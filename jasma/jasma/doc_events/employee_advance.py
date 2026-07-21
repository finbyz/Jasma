import frappe
from frappe import _
from frappe.utils import nowdate


def create_payment_entry(doc, method=None):
    # Prevent duplicate Payment Entry
    if frappe.db.exists(
        "Payment Entry Reference",
        {
            "reference_doctype": "Employee Advance",
            "reference_name": doc.name,
        },
    ):
        return

    # Get Mode of Payment Account for the company
    bank_account = frappe.db.get_value(
        "Mode of Payment Account",
        {
            "parent": doc.mode_of_payment,
            "company": doc.company,
        },
        "default_account",
    )

    if not bank_account:
        frappe.throw(
            _(
                "Default account is not configured for Mode of Payment {0} "
                "for Company {1}"
            ).format(
                frappe.bold(doc.mode_of_payment),
                frappe.bold(doc.company),
            )
        )

    # Create Payment Entry
    pe = frappe.new_doc("Payment Entry")

    pe.payment_type = "Pay"
    pe.company = doc.company
    pe.posting_date = nowdate()

    pe.party_type = "Employee"
    pe.party = doc.employee

    pe.mode_of_payment = doc.mode_of_payment

    # Accounts
    pe.paid_from = bank_account
    pe.paid_to = doc.advance_account

    # Amount
    pe.paid_amount = doc.advance_amount
    pe.received_amount = doc.advance_amount

    # Reference
    pe.append(
        "references",
        {
            "reference_doctype": "Employee Advance",
            "reference_name": doc.name,
            "allocated_amount": doc.advance_amount,
            "total_amount": doc.advance_amount,
            "outstanding_amount": doc.advance_amount,
        },
    )

    pe.flags.ignore_permissions = True
    pe.insert()

    # Submit if required
    # pe.submit()

    frappe.msgprint(
        _("Payment Entry {0} created.").format(pe.name)
    )
    