frappe.ui.form.on('Material Request', {

    onload: function (frm) {
        // check if MR is created from Sales Order
        if (frm.doc.items && frm.doc.items.length > 0) {
            if (frm.doc.items[0].sales_order) {
                frm.set_value('from_document', 'Sales Order');
            }
        }
    },

    refresh: function (frm) {

        // =========================
        // PRODUCTION PLAN BUTTON
        // =========================

        if (frm.doc.docstatus !== 1) return;

        let bom_items = (frm.doc.items || []).filter(row => row.bom_no);
        if (!bom_items.length) return;

        let mr_items = bom_items
            .map(row => row.name)
            .filter(Boolean);

        frappe.call({
            method: "jasma.jasma.doc_events.material_request.get_production_plan_items",
            args: {
                mr_items: mr_items
            },
            callback: function (r) {

                let data = r.message || [];

                let active_exists = false;
                let cancelled_exists = false;

                data.forEach(d => {
                    if (d.docstatus === 2) {
                        cancelled_exists = true;
                    } else {
                        active_exists = true;
                    }
                });

                //  ACTIVE exists → block button
                if (active_exists) return;

                //  ONLY CANCELLED exists → show message but allow button
                if (cancelled_exists) {
                    frm.dashboard.add_comment(
                        __("Previous Production Plan was Cancelled. You can create a new one."),
                        "blue",
                        true
                    );
                }


                frm.add_custom_button('Production Plan', function () {
                    console.log("production plan button clicked")

                    frappe.new_doc('Production Plan', {}, (doc) => {

                        doc.get_items_from = "Material Request";

                        doc.material_requests = [];
                        doc.project = frm.doc.project

                        let mr_row = frappe.model.add_child(
                            doc,
                            "material_requests"
                        );

                        mr_row.material_request = frm.doc.name;
                        mr_row.material_request_date = frappe.datetime.get_today();



                        doc.po_items = [];

                        bom_items.forEach(row => {

                            let item = frappe.model.add_child(
                                doc,
                                "Production Plan Item",
                                "po_items"
                            );

                            item.item_code = row.item_code;
                            item.bom_no = row.bom_no;
                            item.planned_qty = flt(row.qty);
                            item.material_request_item = row.name;
                            item.warehouse = row.warehouse;

                        });

                    });

                }, 'Create');

            }
        });

    }

});