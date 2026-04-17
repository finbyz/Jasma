// frappe.ui.form.on('Production Plan', {
//     refresh: function(frm) {

//         // Only for Draft docs
//         if (frm.doc.docstatus === 0) {

//             // Remove default submit
//             frm.page.clear_primary_action();

//             // Add custom submit
//             frm.page.set_primary_action('Submit', () => {

//                 frappe.confirm(
//                     "Do you want to submit the Material Request?",

//                     // YES → submit MR
//                     () => {
//                         frappe.call({
//                             method: "jasma.jasma.doc_events.production_plan.set_submit_flag",
//                             args: { value: 1 },
//                             callback: () => {
//                                 frm.save('Submit');
//                             }
//                         });
//                     },

//                     // NO → draft MR
//                     () => {
//                         frappe.call({
//                             method: "jasma.jasma.doc_events.production_plan.set_submit_flag",
//                             args: { value: 0 },
//                             callback: () => {
//                                 frm.save('Submit');
//                             }
//                         });
//                     }
//                 );

//             });
//         }
//     }
// });