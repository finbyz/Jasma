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
