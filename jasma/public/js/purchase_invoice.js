frappe.ui.form.on("Purchase Invoice", {
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(
                __("Cash/Discount"),
                function() {
                    frappe.model.open_mapped_doc({
                        method: "jasma.jasma.doc_events.purchase_invoice.make_cash_discount",
                        frm: frm
                    });
                },
                __("Create")
            );
        }
    }
});