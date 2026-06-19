frappe.ui.form.on("Payment Entry", {
	refresh(frm) {
		frm.toggle_reqd(["reference_no", "reference_date"], false);
	},

	paid_from(frm) {
		frm.toggle_reqd(["reference_no", "reference_date"], false);
	},

	paid_to(frm) {
		frm.toggle_reqd(["reference_no", "reference_date"], false);
	},

	before_submit(frm) {
		const is_bank =
			frm.doc.paid_from_account_type === "Bank" ||
			frm.doc.paid_to_account_type === "Bank";

		if (!is_bank) {
			return;
		}

		if (!frm.doc.reference_no) {
			frappe.throw(__("Bank Reference No  is mandatory"));
		}

		if (!frm.doc.reference_date) {
			frappe.throw(__("Bank Reference Date is mandatory"));
		}
	},
});