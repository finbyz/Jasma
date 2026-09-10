frappe.provide("frappe.boot");

if (frappe.boot.user && frappe.boot.user.can_read) {
    frappe.boot.user.can_read = frappe.boot.user.can_read.filter(
        (dt) => dt !== "Non Conformance"
    );
}