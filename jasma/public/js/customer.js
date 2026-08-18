frappe.ui.form.on("Customer", {
    setup(frm) {
        frm.set_query("default_customer_bank_account", function () {
            return {
                filters: {
                    party_type: "Customer",
                    party: frm.doc.name
                }
            };
        });
    },

    onload(frm) {
        frm.set_query("default_customer_bank_account", function () {
            return {
                filters: {
                    party_type: "Customer",
                    party: frm.doc.name
                }
            };
        });
    }
});