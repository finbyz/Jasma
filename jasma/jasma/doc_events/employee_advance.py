import frappe
from frappe import _
from frappe.utils import nowdate

def create_payment_entry(doc, method=None):
    if frappe.db.exists(
        "Payment Entry Reference",
        {
            "reference_doctype": "Employee Advance",
            "reference_name": doc.name,
        },
    ):
        return

    company = frappe.get_doc("Company", doc.company)

    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Pay"
    pe.company = doc.company
    pe.posting_date = nowdate()

    pe.party_type = "Employee"
    pe.party = doc.employee

    # Mode of Payment (change field if different in your Employee Advance)
    pe.mode_of_payment = doc.mode_of_payment


    bank_account =  frappe.db.get_value(
        "Mode of Payment",
        doc.mode_of_payment,
        "default_bank_account",
    )   
    # Accounts (adjust according to your implementation)
    pe.paid_from = bank_account
    pe.paid_to = doc.advance_account

    pe.paid_amount = doc.advance_amount
    pe.received_amount = doc.advance_amount

    pe.append("references", {
        "reference_doctype": "Employee Advance",
        "reference_name": doc.name,
        "allocated_amount": doc.advance_amount,
        "total_amount": doc.advance_amount,
        "outstanding_amount": doc.advance_amount,
    })

    pe.flags.ignore_permissions = True
    pe.insert()
    # pe.submit()

    frappe.msgprint(_("Payment Entry {0} created.").format(pe.name))