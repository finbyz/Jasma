frappe.ui.form.on('Material Request', {
    refresh: function (frm) {

        // Show button only when document is Submitted
        if (frm.doc.docstatus === 1) {

            frm.add_custom_button('Material Request', function () {

                frappe.call({
                    method: 'jasma.jasma.doc_events.material_request.create_manufacture_mr',
                    args: {
                        source_mr: frm.doc.name
                    },
                    callback: function (r) {
                        if (r.message) {
                            frappe.msgprint({
                                title: __('Success'),
                                message: __('New Material Request Created: <a href="/app/material-request/' + r.message + '" target="_blank">' + r.message + '</a>'),
                                indicator: 'green'
                            });
                            // frappe.set_route('Form', 'Material Request', r.message);
                        }
                    }
                });

            }, 'Create');
        }
    }
});