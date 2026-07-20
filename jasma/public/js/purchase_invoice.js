// frappe.ui.form.on("Purchase Invoice", {
//     refresh: function(frm) {
//         if (frm.doc.docstatus === 1 &&  frm.doc.is_return !== 1) {
//             frm.add_custom_button(
//                 __("Cash/Discount"),
//                 function() {
//                     frappe.model.open_mapped_doc({
//                         method: "jasma.jasma.doc_events.purchase_invoice.make_cash_discount",
//                         frm: frm
//                     });
//                 },
//                 __("Create")
//             );
//         }
//     }
// });


frappe.ui.form.on("Purchase Invoice", {
    is_return(frm) {
        if (frm.doc.is_return) {
            handle_return_type(frm);
            frm.set_value("posting_date", frappe.datetime.get_today());

        }
    },
    refresh(frm) {
        if (frm.doc.is_return && !frm.doc.__islocal) {
            frm.set_value("posting_date", frappe.datetime.get_today());
        }
    },
    onload(frm) {
        if (frm.is_new() && frm.doc.is_return) {
            frm.set_value("posting_date", frappe.datetime.get_today());
        }
    },


    return_type(frm) {
        handle_return_type(frm);
    },
    return_against(frm) {
        if (frm.doc.return_against) {
            frappe.db.get_value(
                "Purchase Invoice",
                frm.doc.return_against,
                "bill_date"
            ).then(r => {
                if (r.message.bill_date) {
                    frm.set_value("bill_date", r.message.bill_date);
                }
            });
        }
    }
});

function handle_return_type(frm) {
    if (!frm.doc.is_return) {
        return;
    }

    if (frm.doc.return_type === "Service") {
        // Clear Return Against
        frm.set_value("return_against", "");

        // Clear Items
        frm.clear_table("items");
        frm.refresh_field("items");
    }
}