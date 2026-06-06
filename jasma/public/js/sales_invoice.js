frappe.ui.form.on('Sales Invoice', {
    refresh(frm) {

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
    validate(frm) {

        // Total Value = Net Total
        frm.set_value(
            'total_value',
            flt(frm.doc.net_total)
        );

        // Total FOB Value = Net Total + Freight + Insurance
        frm.set_value(
            'total_fob_values',
            flt(frm.doc.net_total)
            - flt(frm.doc.freight)
            - flt(frm.doc.insurance)
        );

    },

    setup: function (frm) {

        frm.set_query('item_code', 'packing_slip', function (doc) {

            let item_list = [];

            (doc.items || []).forEach(row => {
                if (row.item_code) {
                    item_list.push(row.item_code);
                }
            });

            return {
                filters: {
                    name: ['in', item_list]
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
    length: calculate_cbm,
    width: calculate_cbm,
    height: calculate_cbm,

    box_from: calculate_total_box,
    box_to: calculate_total_box,

    qty: function (frm, cdt, cdn) {

        let row = locals[cdt][cdn];
        // 1. TOTAL VALIDATION
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
            frappe.model.set_value(cdt, cdn, 'qty', 0);
            return;
        }

        // 2. ITEM-WISE VALIDATION
        if (row.item_code) {

            let item_qty = 0;
            let packing_item_qty = 0;

            // Get qty from Items table for this item
            (frm.doc.items || []).forEach(d => {
                if (d.item_code === row.item_code) {
                    item_qty += flt(d.qty);
                }
            });

            // Get packing qty for same item
            (frm.doc.packing_slip || []).forEach(d => {
                if (d.item_code === row.item_code) {
                    packing_item_qty += flt(d.qty);
                }
            });

            if (packing_item_qty > item_qty) {
                frappe.msgprint(
                    `Packing Qty for Item ${row.item_code} cannot exceed ${item_qty}`
                );

                frappe.model.set_value(cdt, cdn, 'qty', 0);
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


frappe.ui.form.on('Sales Invoice Packing Slip', {
    length: calculate_cbm,
    width: calculate_cbm,
    height: calculate_cbm,

    box_from: calculate_total_box,
    box_to: calculate_total_box,

    qty: function (frm, cdt, cdn) {

        let row = locals[cdt][cdn];

        // 1. TOTAL VALIDATION
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
            frappe.model.set_value(cdt, cdn, 'qty', 0);
            return;
        }

        // 2. ITEM-WISE VALIDATION
        if (row.item_code) {

            let item_qty = 0;
            let packing_item_qty = 0;

            (frm.doc.items || []).forEach(d => {
                if (d.item_code === row.item_code) {
                    item_qty += flt(d.qty);
                }
            });

            (frm.doc.packing_slip || []).forEach(d => {
                if (d.item_code === row.item_code) {
                    packing_item_qty += flt(d.qty);
                }
            });

            if (packing_item_qty > item_qty) {
                frappe.msgprint(
                    `Packing Qty for Item ${row.item_code} cannot exceed ${item_qty}`
                );

                frappe.model.set_value(cdt, cdn, 'qty', 0);
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