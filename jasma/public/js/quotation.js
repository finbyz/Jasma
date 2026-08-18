frappe.ui.form.on("Quotation", {
    setup(frm) {
        set_port_filters(frm);
        load_manual_rate_setting(frm);
    },
    onload(frm) {
        set_country_of_destination(frm);
    },
    

    // refresh(frm) {
    //     set_country_of_destination(frm);
    // },

    shipping_address_name(frm) {
        set_country_of_destination(frm);
    },

    customer_address(frm) {
        set_country_of_destination(frm);
    },
    refresh(frm) {
        load_manual_rate_setting(frm);
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




frappe.ui.form.on("Quotation Item", {
    item_code(frm, cdt, cdn) {
        clear_price_list_rate_if_required(frm, cdt, cdn);
    },

    price_list_rate(frm, cdt, cdn) {
        clear_price_list_rate_if_required(frm, cdt, cdn);
    },
    qty(frm, cdt, cdn) {
        clear_price_list_rate_if_required(frm, cdt, cdn);
    }
});


function load_manual_rate_setting(frm) {
    frappe.db.get_single_value(
        "Selling Settings",
        "disable_quotation_auto_price_list_rate_"
    ).then(value => {
        frm._disable_auto_price_list_rate = cint(value);
    });
}


function clear_price_list_rate_if_required(frm, cdt, cdn) {
    if (!frm._disable_auto_price_list_rate) {
        return;
    }

    let row = locals[cdt][cdn];

    if (!row || !row.item_code) {
        return;
    }

    // Clear immediately
    frappe.model.set_value(cdt, cdn, "price_list_rate", 0);

    // Clear again after ERPNext standard item-price fetching
    setTimeout(() => {
        if (!frm.doc.items) {
            return;
        }

        let current_row = locals[cdt][cdn];

        if (
            current_row &&
            current_row.item_code &&
            frm._disable_auto_price_list_rate
        ) {
            frappe.model.set_value(
                cdt,
                cdn,
                "price_list_rate",
                0
            );
        }
    }, 500);
}