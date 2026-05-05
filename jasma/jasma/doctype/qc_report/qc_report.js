// Copyright (c) 2026, Finbyz tech and contributors
// For license information, please see license.txt

// Creation Code
// frappe.ui.form.on("QC Report", {
//     refresh(frm) {
        
//         if (frm.doc.docstatus === 1 && frm.doc.status !== "Accepted") {
//             frm.add_custom_button("Non - Conformance", function () {
//                 frappe.call({
//                     method: "jasma.jasma.doctype.qc_report.qc_report.create_non_conformance",
//                     args: {
//                         docname: frm.doc.name
//                     },
//                     callback: function(r) {
//                         if (r.message) {
//                             frappe.set_route("Form", "Non - Conformance", r.message);
//                         }
//                     }
//                 });
//             }, "Create");
//         }
//     }
// });


frappe.ui.form.on("QC Report", {

     before_submit(frm) {
        if (!frm.doc.qc_status) {
            frappe.throw("Status is Required");
        }
    },
    
    refresh(frm) {
        
        if (frm.doc.docstatus === 1 && frm.doc.qc_status !== "Accepted") {
            
            frm.add_custom_button("Non - Conformance", function () {

                frappe.call({
                    method: "jasma.jasma.doctype.qc_report.qc_report.get_nc_data",
                    args: {
                        docname: frm.doc.name
                    },
                    callback: function(r) {

                        if (r.message) {
                            
                            // ✅ Open new doc with prefilled data (NOT SAVED)
                            frappe.new_doc("Non - Conformance", r.message);
                        }
                    }
                });

            }, "Create");
        }
    }
});