frappe.ui.form.on("Sales Order", {
    setup(frm) {
        set_port_filters(frm);
        setup_create_button_filtering(frm);
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
        apply_sales_order_create_button_settings(frm);
    }
});

function set_country_of_destination(frm) {
    if (frm.doc.docstatus !== 0) {
        return;
    }

    let address = frm.doc.shipping_address_name || frm.doc.customer_address;

    if (address) {
        frappe.db.get_value("Address", address, "country")
            .then(r => {
                if (frm.doc.docstatus !== 0) return;
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


// --- Sales Order "Create" button visibility controlled by Selling Settings ---

const SO_CREATE_BUTTON_SETTINGS_MAP = {
    "Contract Term": "so_create_contract_term",
    "Pick List": "so_create_pick_list",
    "Delivery Note": "so_create_delivery_note",
    "Work Order": "so_create_work_order",
    "Production Plan": "so_create_production_plan",
    "Sales Invoice": "so_create_sales_invoice",
    "Material Request": "so_create_material_request",
    "Request for Raw Materials": "so_create_request_for_raw_materials",
    "Purchase Order": "so_create_purchase_order",
    "AO Number": "so_create_ao_number",
    "Project": "so_create_ao_number",
    "Payment Request": "so_create_payment_request",
    "Payment": "so_create_payment",
    "Maintenance Visit": "so_create_maintenance_visit",
    "Maintenance Schedule": "so_create_maintenance_schedule"
};

function is_so_create_group(group) {
    if (!group) return false;
    let clean = group.toString().trim();
    return clean === "Create" || clean === __("Create");
}

function get_so_button_setting_field(label) {
    if (!label) return null;
    let clean = label.toString().trim();
    if (SO_CREATE_BUTTON_SETTINGS_MAP[clean]) {
        return SO_CREATE_BUTTON_SETTINGS_MAP[clean];
    }
    for (let [btn, fld] of Object.entries(SO_CREATE_BUTTON_SETTINGS_MAP)) {
        if (clean === __(btn) || clean.toLowerCase() === btn.toLowerCase()) {
            return fld;
        }
    }
    return null;
}

function is_so_create_button_allowed(label, settings) {
    if (!label || !settings) return true;
    let field = get_so_button_setting_field(label);
    if (!field) return true;
    if (Object.prototype.hasOwnProperty.call(settings, field) && settings[field] !== null && settings[field] !== undefined) {
        return cint(settings[field]) === 1;
    }
    return true;
}

function setup_create_button_filtering(frm) {
    if (frm._create_button_filter_initialized) return;
    frm._create_button_filter_initialized = true;

    const original_add_custom_button = frm.add_custom_button.bind(frm);
    frm.add_custom_button = function (label, action, group) {
        if (is_so_create_group(group) && frm._selling_settings) {
            if (!is_so_create_button_allowed(label, frm._selling_settings)) {
                return $();
            }
        }
        return original_add_custom_button(label, action, group);
    };
}

function apply_sales_order_create_button_settings(frm) {
    if (locals["Selling Settings"] && locals["Selling Settings"]["Selling Settings"]) {
        const cached = locals["Selling Settings"]["Selling Settings"];
        frm._selling_settings = cached;
        filter_create_dropdown_buttons(frm, cached);
    }

    frappe.db.get_doc("Selling Settings").then(settings => {
        if (!settings) return;
        frm._selling_settings = settings;
        filter_create_dropdown_buttons(frm, settings);

        setTimeout(() => filter_create_dropdown_buttons(frm, settings), 50);
        setTimeout(() => filter_create_dropdown_buttons(frm, settings), 200);
        setTimeout(() => filter_create_dropdown_buttons(frm, settings), 500);
    });
}

function filter_create_dropdown_buttons(frm, settings) {
    if (!frm || !frm.page || !settings) return;

    const group_labels = [__("Create"), "Create"];
    let $group = null;

    for (let gl of group_labels) {
        let $g = frm.page.get_inner_group_button(gl);
        if ($g && $g.length) {
            $group = $g;
            break;
        }
    }

    if ($group && $group.length) {
        $group.find(".dropdown-item").each(function () {
            const $item = $(this);
            const text_label = $item.text().trim();
            const data_label = decodeURIComponent($item.attr("data-label") || "").trim();

            const is_disallowed = 
                (text_label && !is_so_create_button_allowed(text_label, settings)) ||
                (data_label && !is_so_create_button_allowed(data_label, settings));

            if (is_disallowed) {
                if (frm.custom_buttons) {
                    delete frm.custom_buttons[text_label];
                    if (data_label) delete frm.custom_buttons[data_label];
                }
                $item.remove();
            }
        });

        if ($group.find(".dropdown-item").length === 0) {
            $group.remove();
        }
    }

    if (frm.page.menu) {
        frm.page.menu.find("li > a.grey-link").each(function () {
            const $menu_link = $(this);
            const menu_text = $menu_link.text().trim();
            for (let [btn, fld] of Object.entries(SO_CREATE_BUTTON_SETTINGS_MAP)) {
                if (menu_text.includes(btn) || menu_text.includes(__(btn))) {
                    if (!is_so_create_button_allowed(btn, settings)) {
                        $menu_link.parent().remove();
                    }
                }
            }
        });
    }
}

