from hrms.overrides.employee_payment_entry import EmployeePaymentEntry


class PaymentEntry(EmployeePaymentEntry):
    def validate_transaction_reference(self):
        if self.docstatus == 0:
            return

        super().validate_transaction_reference()
