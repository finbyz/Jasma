frappe.ui.form.on("Payment Entry", {
    refresh(frm) {
        setTimeout(() => {
            frm.toggle_reqd("reference_no", false);
            frm.toggle_reqd("reference_date", false);
        }, 100);
    },

    paid_from(frm) {
        setTimeout(() => {
            frm.toggle_reqd("reference_no", false);
            frm.toggle_reqd("reference_date", false);
        }, 100);
    },

    paid_to(frm) {
        setTimeout(() => {
            frm.toggle_reqd("reference_no", false);
            frm.toggle_reqd("reference_date", false);
        }, 100);
    },

    bank_account(frm) {
        setTimeout(() => {
            frm.toggle_reqd("reference_no", false);
            frm.toggle_reqd("reference_date", false);
        }, 100);
    },

    before_submit(frm) {
        const is_bank =
            frm.doc.paid_from_account_type === "Bank" ||
            frm.doc.paid_to_account_type === "Bank";

        if (is_bank && (!frm.doc.reference_no || !frm.doc.reference_date)) {
            frappe.throw(__("Bank Reference No and Bank Reference Date are mandatory."));
        }
    }
});