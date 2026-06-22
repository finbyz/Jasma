frappe.ui.form.on('Sales Invoice', {
    packing_charges(frm) {
         distribute_packing_charges(frm);
    },

    packing_charges_by(frm) {
        distribute_packing_charges(frm);
    },
    refresh(frm) {
        // calculate_packing_totals(frm);
       
        // calculate_total_fob_values(frm);
    

        let currency = frm.doc.currency || '';


        frm.set_df_property(
            "total_value",
            "options",
            "currency"
        );

        frm.set_df_property(
            "total_fob_values",
            "options",
            "currency"
        );

        frm.refresh_fields([
            "total_value",
            "total_fob_values"
        ]);

        frm.set_df_property(
            'total_value',
            'label',
            `Total Value (${currency})`
        );

        frm.set_df_property(
            'total_fob_values',
            'label',
            `Total FOB Value (${currency})`
        );

        const is_manual =
            frm.doc.freight_calculated === "By Amount" ||
            frm.doc.freight_calculated === "By Qty";

        const read_only = is_manual ? 0 : 1;

        frm.set_df_property("freight", "read_only", read_only);
        frm.set_df_property("insurance", "read_only", read_only);

        frm.set_df_property("freight", "read_only_depends_on", " ");
        frm.set_df_property("insurance", "read_only_depends_on", " ");

        console.log("freight read_only:", read_only);
        console.log("insurance read_only:", read_only);

        frm.refresh_field("freight");
        frm.refresh_field("insurance");

        update_commercial_items_after_mapping(frm);
    },

    onload(frm) {
        const is_manual =
            frm.doc.freight_calculated === "By Amount" ||
            frm.doc.freight_calculated === "By Qty";

        const read_only = is_manual ? 0 : 1;
    },

    currency(frm) {

        let currency = frm.doc.currency || '';

        frm.set_df_property(
            'total_value',
            'label',
            `Total Value (${currency})`
        );

        frm.set_df_property(
            'total_fob_values',
            'label',
            `Total FOB Value (${currency})`
        );

    },
    
    total_fob_value: function (frm) {
        calculate_total_fob_values(frm);
    },

    // ── Recalculate when exchange rate changes ────────────────────────────
    conversion_rate: function (frm) {
        calculate_total_fob_values(frm);
    },

    // ── Recalculate on document load (handles saved docs) ─────────────────
    

    before_save: function (frm) {
        calculate_total_fob_values(frm);
    },
    
   validate(frm) {
   
    calculate_packing_totals(frm);
},


    setup: function(frm) {

    frm.set_query("packed_item_code", "packing_slip", function(doc) {

        const item_list = (doc.items || [])
            .filter(d => d.item_code)
            .map(d => d.item_code);

        return {
            filters: {
                name: ["in", item_list.length ? item_list : [""]]
            }
        };
    });

},

    qty: function (frm, cdt, cdn) {

        let item_total = 0;
        let packing_total = 0;

        // Items table total
        (frm.doc.items || []).forEach(row => {
            item_total += row.qty || 0;
        });

        // Packing Slip total
        (frm.doc.packing_slip || []).forEach(row => {
            packing_total += row.qty || 0;
        });

        if (packing_total > item_total) {
            frappe.msgprint("Packing Qty cannot exceed Item Total Qty");

            // reset current row qty
            let row = locals[cdt][cdn];
            row.qty = 0;

            frm.refresh_field('packing_slip');
        }
    },
});

frappe.ui.form.on('Sales Invoice Packing Slip', {

    nt_wt(frm) {
        calculate_packing_totals(frm);
    },
    gr_wt(frm) {
        calculate_packing_totals(frm);
    },
    box_from(frm) {
        calculate_packing_totals(frm);
    },
    box_to(frm) {
        calculate_packing_totals(frm);
    },
    packing_type(frm) {
        calculate_packing_totals(frm);
    },
    packing_slip_remove(frm) {
        calculate_packing_totals(frm);
    },

    packed_item_code(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        console.log("Packing Row");
        console.log(row);

        console.log("Items");
        console.log(frm.doc.items);
    },

    length: calculate_cbm,
    width: calculate_cbm,
    height: calculate_cbm,

    box_from: calculate_total_box,
    box_to: calculate_total_box,

    qty(frm, cdt, cdn) {

        let row = locals[cdt][cdn];

        let item_total = 0;
        let packing_total = 0;

        (frm.doc.items || []).forEach(d => {
            item_total += flt(d.qty);
        });

        (frm.doc.packing_slip || []).forEach(d => {
            packing_total += flt(d.qty);
        });

        if (packing_total > item_total) {
            frappe.msgprint("Packing Qty cannot exceed Item Total Qty");
            row.qty = 0;
            frm.refresh_field("packing_slip");
            return;
        }

        if (row.packed_item_code) {

            let item_qty = 0;
            let packing_item_qty = 0;

            (frm.doc.items || []).forEach(d => {
                if (d.item_code === row.packed_item_code) {
                    item_qty += flt(d.qty);
                }
            });

            (frm.doc.packing_slip || []).forEach(d => {
                if (d.packed_item_code === row.packed_item_code) {
                    packing_item_qty += flt(d.qty);
                }
            });

            if (packing_item_qty > item_qty) {

                frappe.msgprint(
                    `Packing Qty for Item ${row.packed_item_code} cannot exceed ${item_qty}`
                );

                row.qty = 0;
                frm.refresh_field("packing_slip");
            }
        }
    }
});


function calculate_cbm(frm, cdt, cdn) {

    let row = locals[cdt][cdn];

    let l = row.length || 0;
    let w = row.width || 0;
    let h = row.height || 0;

    row.cbm = (l * w * h) / 1000000000;

    frm.refresh_field('packing_slip');
}

function calculate_total_box(frm, cdt, cdn) {

    let row = locals[cdt][cdn];

    let box_from = cint(row.box_from || 0);
    let box_to = cint(row.box_to || 0);

    if (box_from && box_to && box_to >= box_from) {

        let total_box = (box_to - box_from) + 1;

        frappe.model.set_value(cdt, cdn, 'total_box', total_box);

    } else {

        frappe.model.set_value(cdt, cdn, 'total_box', 0);
    }
}




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

function calculate_packing_totals(frm) {

    let total_nt_wt = 0;
    let total_gr_wt = 0;

    let unique_boxes = new Set();
    let total_pkg = 0;

    (frm.doc.packing_slip || []).forEach(row => {

        total_nt_wt += flt(row.nt_wt);
        total_gr_wt += flt(row.gr_wt);

        if ((row.packing_type || "").toLowerCase() === "pkg") {

            if (row.box_from && row.box_to) {
                total_pkg += (cint(row.box_to) - cint(row.box_from) + 1);
            } else {
                total_pkg += cint(row.total_box || 0);
            }

        } else {

            if (row.box_from && row.box_to) {

                for (let i = cint(row.box_from); i <= cint(row.box_to); i++) {
                    unique_boxes.add(i);
                }

            }
        }
    });

    let total_boxes = unique_boxes.size;

    let total_boxes_and_packages = "";

    if (total_boxes > 0) {
        total_boxes_and_packages += `${total_boxes} BOX${total_boxes > 1 ? "ES" : ""}`;
    }

    if (total_boxes > 0 && total_pkg > 0) {
        total_boxes_and_packages += " and ";
    }

    if (total_pkg > 0) {
        total_boxes_and_packages += `${total_pkg} PACKAGE${total_pkg > 1 ? "S" : ""}`;
    }

    if (!total_boxes_and_packages) {
        total_boxes_and_packages = "0 PACKAGES";
    }

    frm.set_value("total_nt_wt", total_nt_wt);
    frm.set_value("total_gr_wtg", total_gr_wt);
    frm.set_value("total_boxes_and_packages", total_boxes_and_packages);
}




// ── Calculation function ──────────────────────────────────────────────────────
function calculate_total_fob_values(frm) {
    const base_fob        = flt(frm.doc.total_fob_value);
    const conversion_rate = flt(frm.doc.conversion_rate);

   

    if (!base_fob || !conversion_rate) {
        frm.set_value("total_fob_values", 0);
        return;
    }

    const result = flt(base_fob / conversion_rate, 2);

    frm.set_value("total_fob_values", result);
    frm.set_value("total_value", frm.doc.total);
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


frappe.ui.form.on('Commercial Item', {
    quantity: calculate_commercial_item_amount,
    rate: calculate_commercial_item_amount
});

function calculate_commercial_item_amount(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let amount = flt(row.quantity) * flt(row.rate);

    frappe.model.set_value(cdt, cdn, "amount", flt(amount, precision("amount", row)));
}
