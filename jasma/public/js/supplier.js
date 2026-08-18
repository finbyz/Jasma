frappe.ui.form.on("Supplier", {
    setup(frm) {
        frm.set_query("bank_account", function () {
            return {
                filters: {
                    party_type: "Supplier",
                    party: frm.doc.name
                }
            };
        });
    },

    onload(frm) {
        frm.set_query("bank_acccount", function () {
            return {
                filters: {
                    party_type: "Supplier",
                    party: frm.doc.name
                }
            };
        });
    }
});