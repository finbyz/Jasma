from erpnext.accounts.doctype.payment_entry.payment_entry import PaymentEntry as _PaymentEntry
import frappe
from frappe import _

class PaymentEntry(_PaymentEntry):

    def validate_transaction_reference(self):
        # Skip ERPNext validation during validate
        pass

    def before_submit(self):
        # Run ERPNext's original before_submit logic
        super().before_submit()

        bank_account = self.paid_to if self.payment_type == "Receive" else self.paid_from

        bank_account_type = frappe.get_cached_value(
            "Account",
            bank_account,
            "account_type"
        )

        if (
            bank_account_type == "Bank"
            and (not self.reference_no or not self.reference_date)
        ):
            frappe.throw(
                _("Reference No and Reference Date is mandatory for Bank transaction")
            )