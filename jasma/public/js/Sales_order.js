frappe.ui.form.on("Sales Order", {
    setup(frm) {
        set_port_filters(frm);
    },
    shipping_address_name(frm) {
        set_country_of_destination(frm);
    },

    customer_address(frm) {
        set_country_of_destination(frm);
    },
    packing_charges(frm) {
         distribute_packing_charges(frm);
    },

    packing_charges_by(frm) {
        distribute_packing_charges(frm);
    },
    refresh(frm) {
        update_commercial_items_after_mapping(frm);
    }
});

function set_country_of_destination(frm) {

    let address = frm.doc.shipping_address_name || frm.doc.customer_address;

    if (address) {
        frappe.db.get_value("Address", address, "country")
            .then(r => {
                if (r.message && r.message.country) {
                    frm.set_value("country_of_destination", r.message.country);
                } else {
                    frm.set_value("country_of_destination", "");
                }
            });
    } else {
        frm.set_value("country_of_destination", "");
    }
}

function set_port_filters(frm) {

    // Port of Loading → filter by Country of Origin
    frm.set_query("port_of_loading", function () {
        return {
            filters: {
                country: frm.doc.country_of_origin
            }
        };
    });

    // Port of Discharge → filter by Country of Destination
    frm.set_query("port_of_discharge", function () {
        return {
            filters: {
                country: frm.doc.country_of_destination
            }
        };
    });
}


// function distribute_packing_charges(frm) {

//     if (!frm.doc.packing_charges || !frm.doc.items?.length) {
//         return;
//     }

//     frm.doc.items.forEach(row => {

//         let packing_amount = 0;

//         if (frm.doc.packing_charges_by === "By Amount") {

//             if (!frm.doc.net_total) return;

//             let packing_percent = (flt(row.amount) * 100) / flt(frm.doc.net_total);
//             packing_amount = (flt(frm.doc.packing_charges) * packing_percent) / 100;
//             packing_amount = flt(packing_amount) / flt(row.qty);
//         } else if (frm.doc.packing_charges_by === "By Qty") {

//             if (!frm.doc.total_qty) return;

//             let packing_percent = (flt(row.qty) * 100) / flt(frm.doc.total_qty);
//             packing_amount = (flt(frm.doc.packing_charges) * packing_percent) / 100;
//             packing_amount = flt(packing_amount) / flt(row.qty);
//         }

//         frappe.model.set_value(
//             row.doctype,
//             row.name,
//             "rate",
//             flt(row.rate) + flt(packing_amount)
//         );
//     });

//     frm.refresh_field("items");
// }


function distribute_packing_charges(frm) {

    if (!frm.doc.packing_charges || !frm.doc.items?.length) {
        return;
    }

    frm.doc.items.forEach(row => {

        let final_rate = flt(row.rate);

        if (frm.doc.packing_charges_by === "By Amount") {

            if (!frm.doc.net_total || !row.qty) return;

            let ratio = flt(row.amount) / flt(frm.doc.net_total);
            let distributed_amount = flt(frm.doc.packing_charges) * ratio;
            let packing_rate = distributed_amount / flt(row.qty);

            final_rate = flt(row.rate) + flt(packing_rate);

        } else if (frm.doc.packing_charges_by === "By Qty") {

            if (!frm.doc.total_qty || !row.qty) return;

            let ratio = flt(row.qty) / flt(frm.doc.total_qty);
            let distributed_amount = flt(frm.doc.packing_charges) * ratio;
            let packing_rate = distributed_amount / flt(row.qty);

            final_rate = flt(row.rate) + flt(packing_rate);
        }

        frappe.model.set_value(
            row.doctype,
            row.name,
            "rate",
            flt(final_rate, 6)
        );
    });

    frm.refresh_field("items");
}




function get_commercial_item_rows(frm) {
    return (frm.doc.items || []).map(row => ({
        commercial_item_code: row.item_code || "",
        commercial_item_name: row.item_name || "",
        description: row.description || "",
        quantity: flt(row.qty),
        rate: flt(row.rate),
        amount: flt(row.amount)
    }));
}

function commercial_items_are_synced(frm, expected_rows) {
    let current_rows = frm.doc.commercial_item || [];

    if (current_rows.length !== expected_rows.length) {
        return false;
    }

    return expected_rows.every((expected, idx) => {
        let current = current_rows[idx] || {};

        return (
            (current.commercial_item_code || "") === expected.commercial_item_code &&
            (current.commercial_item_name || "") === expected.commercial_item_name &&
            (current.description || "") === expected.description &&
            flt(current.quantity) === expected.quantity &&
            flt(current.rate) === expected.rate &&
            flt(current.amount) === expected.amount
        );
    });
}

function update_commercial_items_after_mapping(frm) {
    if (!frm.doc.__unsaved || !(frm.doc.items || []).length) {
        return;
    }

    update_commercial_items(frm);
}

function update_commercial_items(frm) {
    if (!frm.fields_dict.commercial_item) {
        return;
    }

    let commercial_rows = get_commercial_item_rows(frm);

    if (commercial_items_are_synced(frm, commercial_rows)) {
        return;
    }

    frm.clear_table("commercial_item");
    

    commercial_rows.forEach(row => {
        let d = frm.add_child("commercial_item");
        d.commercial_item_code = row.commercial_item_code;
        d.commercial_item_name = row.commercial_item_name;
        d.description = row.description;
        d.quantity = row.quantity;
        d.rate = row.rate;
        d.amount = row.amount;
    });

    frm.refresh_field("commercial_item");
}


frappe.ui.form.on('Sales Order Commercial Item', {
    quantity: calculate_commercial_item_amount,
    rate: calculate_commercial_item_amount
});

function calculate_commercial_item_amount(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let amount = flt(row.quantity) * flt(row.rate);

    frappe.model.set_value(cdt, cdn, "amount", flt(amount, precision("amount", row)));
}
