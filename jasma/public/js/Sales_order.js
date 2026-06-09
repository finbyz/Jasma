frappe.ui.form.on("Sales Order", {
    setup(frm) {
        set_port_filters(frm);
    },
    onload(frm) {
        set_country_of_destination(frm);
    },

    refresh(frm) {
        set_country_of_destination(frm);
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


function distribute_packing_charges(frm) {

    if (!frm.doc.packing_charges || !frm.doc.items?.length) {
        return;
    }

    frm.doc.items.forEach(row => {

        let packing_amount = 0;

        if (frm.doc.packing_charges_by === "By Amount") {

            if (!frm.doc.net_total) return;

            let packing_percent = (flt(row.amount) * 100) / flt(frm.doc.net_total);
            packing_amount = (flt(frm.doc.packing_charges) * packing_percent) / 100;

        } else if (frm.doc.packing_charges_by === "By Qty") {

            if (!frm.doc.total_qty) return;

            let packing_percent = (flt(row.qty) * 100) / flt(frm.doc.total_qty);
            packing_amount = (flt(frm.doc.packing_charges) * packing_percent) / 100;
        }

        frappe.model.set_value(
            row.doctype,
            row.name,
            "rate",
            flt(row.rate) + flt(packing_amount)
        );
    });

    frm.refresh_field("items");
}