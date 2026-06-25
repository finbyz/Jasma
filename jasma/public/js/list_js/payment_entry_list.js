frappe.listview_settings['Payment Entry'] = {
    onload(listview) {

        listview.page.add_inner_button(__('Export to Excel'), function () {

            let selected = listview.get_checked_items();

            if (!selected.length) {
                frappe.msgprint(__('Please select Payment Entries'));
                return;
            }

            let names = selected.map(d => d.name);

            frappe.call({
                method: "jasma.api.export_payment_entries",
                args: {
                    payment_entries: names
                },
                callback(r) {
                    if (r.message) {
                        window.open(r.message);
                    }
                }
            });

        });

    }
};