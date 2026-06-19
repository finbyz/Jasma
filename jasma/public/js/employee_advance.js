frappe.ui.form.on('Employee Advance', {
    paid_amount(frm) {
        calculate_balance(frm);
    },

    claimed_amount(frm) {
        calculate_balance(frm);
    },

    return_amount(frm) {
        calculate_balance(frm);
    },

    validate(frm) {
        calculate_balance(frm);
    }
});

function calculate_balance(frm) {
    frm.set_value(
        'balance_amount',
        flt(frm.doc.paid_amount)
        - flt(frm.doc.claimed_amount)
        - flt(frm.doc.return_amount)
    );
}