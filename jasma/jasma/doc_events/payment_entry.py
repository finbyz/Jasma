import frappe
from frappe.utils import  getdate, nowdate,flt
from frappe import _

def update_employee_advance_balance(doc, method):

    for ref in doc.references:

        if ref.reference_doctype != "Employee Advance":
            continue

        ea = frappe.get_doc("Employee Advance", ref.reference_name)

        balance_amount = (
            flt(ea.paid_amount)
            - flt(ea.claimed_amount)
            - flt(ea.return_amount)
        )

        frappe.db.set_value(
            "Employee Advance",
            ea.name,
            "balance_amount",
            balance_amount,
            update_modified=False
        )
        

def validate_future_payment_date(self, method=None):
    if getdate(self.posting_date) > getdate(nowdate()):
        frappe.throw(_("Payment Date cannot be a future date."))