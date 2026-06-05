frappe.ui.form.on("Item", {
    setup: function(frm) {
        frm.set_query("service_item", function() {
            return {
                filters: {
                    is_stock_item: 0
                }
            };
        });
    }
});