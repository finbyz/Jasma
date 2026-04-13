// Copyright (c) 2026, Finbyz tech and contributors
// For license information, please see license.txt

// frappe.ui.form.on("QC Report", {
// 	refresh(frm) {

// 	},
// });


// frappe.ui.form.on("QC Report", {
//     refresh(frm) {
//         if (frm.doc.status && frm.doc.status !== "Accepted") {
//             frm.add_custom_button("Non Conformance", function () {
//                 frappe.new_doc("Non Conformance");
//             }, "Create");
//         }
//     }
// });

frappe.ui.form.on("QC Report", {
    refresh(frm) {
        
        if (frm.doc.docstatus === 1 && frm.doc.status !== "Accepted") {
            frm.add_custom_button("Non - Conformance", function () {
                frappe.call({
                    method: "jasma.jasma.doctype.qc_report.qc_report.create_non_conformance",
                    args: {
                        docname: frm.doc.name
                    },
                    callback: function(r) {
                        if (r.message) {
                            frappe.set_route("Form", "Non - Conformance", r.message);
                        }
                    }
                });
            }, "Create");
        }
    }
});