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


        // Only a submitted, Stopped MR can be marked Shipped.
        if (frm.doc.docstatus === 1 && frm.doc.status === 'Stopped') {
            frm.add_custom_button(__('Shipped'), function () {
                frappe.confirm(
                    __('Mark this Material Request as Shipped?'),
                    function () {
                        frappe.call({
                            method: 'jasma.jasma.doc_events.material_request.mark_material_request_shipped',
                            args: { material_request: frm.doc.name },
                            freeze: true,
                            freeze_message: __('Updating status...'),
                            callback: function (r) {
                                if (!r.exc) {
                                    frappe.show_alert({ message: __('Marked as Shipped'), indicator: 'green' });
                                    frm.reload_doc();
                                }
                            }
                        });
                    }
                );
            }).addClass('btn-primary');
        }

        
        if (frm.doc.status === 'Shipped') {
            frm.page.set_indicator(__('Shipped'), 'blue');
            watch_and_hide_stop_button(frm);
        }
        // =========================
        // PRODUCTION PLAN BUTTON
        // =========================

        if (frm.doc.docstatus !== 1) return;

        /*
            CONDITIONS

            no bom_no + no pp_reference -> no button
            bom_no + no pp_reference    -> show button
            bom_no + pp_reference       -> no button
        */

        let eligible_items = (frm.doc.items || []).filter(row =>
            row.bom_no && !row.pp_reference
        );

        // No eligible items
        if (!eligible_items.length) return;

        let mr_items = eligible_items
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

                // ACTIVE exists → block button
                if (active_exists) return;

                // ONLY CANCELLED exists → show message but allow button
                if (cancelled_exists) {

                    frm.dashboard.add_comment(
                        __("Previous Production Plan was Cancelled. You can create a new one."),
                        "blue",
                        true
                    );
                }

                frm.add_custom_button('Production Plan', function () {

                    console.log("production plan button clicked");

                    frappe.new_doc('Production Plan', {}, (doc) => {

                        doc.get_items_from = "Material Request";
                        doc.material_request = frm.doc.name;

                        doc.material_requests = [];
                        doc.project = frm.doc.project;

                        let mr_row = frappe.model.add_child(
                            doc,
                            "material_requests"
                        );

                        mr_row.material_request = frm.doc.name;
                        mr_row.material_request_date = frappe.datetime.get_today();

                        doc.po_items = [];

                        // ONLY eligible items
                        eligible_items.forEach(row => {

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


// this form stays open on a Shipped MR.
function watch_and_hide_stop_button(frm) {
    if (frm.__shipped_stop_observer) return; // already watching this form instance

    const stop_label = __('Stop');
    const container = frm.page.wrapper.get(0);

    const remove_stop = () => {
        if (frm.doc.status !== 'Shipped') return;
        container.querySelectorAll('a, button, .btn, li').forEach(function (el) {
            if (el.textContent.trim() === stop_label && el.children.length === 0) {
                (el.closest('li') || el.closest('.btn-group') || el).remove();
            }
        });
    };

    remove_stop();
    const observer = new MutationObserver(remove_stop);
    observer.observe(container, { childList: true, subtree: true });
    frm.__shipped_stop_observer = observer;
}