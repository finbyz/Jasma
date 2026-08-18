// Wraps ERPNext core's own frappe.listview_settings['Material Request']
// .get_indicator (defined in erpnext's material_request_list.js, loaded
// before this file - see hooks.py doctype_list_js). Core's version has no
// case for "Shipped" (only Draft/Stopped/Pending/Partially Ordered/
// Ordered/Issued/Transferred/Received/Cancelled), so list rows never
// picked it up. This checks for Shipped first and falls back to core's
// original logic for every other status, rather than replacing it outright.
frappe.provide('frappe.listview_settings');

(function () {
    const settings = frappe.listview_settings['Material Request'] || {};
    const original_get_indicator = settings.get_indicator;

    settings.get_indicator = function (doc) {
        if (doc.status === 'Shipped') {
            return [__('Shipped'), 'blue', 'status,=,Shipped'];
        }
        return original_get_indicator ? original_get_indicator(doc) : null;
    };

    frappe.listview_settings['Material Request'] = settings;
})();