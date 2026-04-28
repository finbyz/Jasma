frappe.ui.form.on("Purchase Order", {

    is_subcontracted: function (frm) {
        if (frm.doc.is_subcontracted) {

            // Delay execution by 1 second (1000 ms)
            setTimeout(() => {
                (frm.doc.items || []).forEach(function (row) {
                    frappe.model.set_value(row.doctype, row.name, "fg_item_qty", row.qty);
                });
            }, 1000);

        }
    }

});