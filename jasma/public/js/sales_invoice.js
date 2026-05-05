frappe.ui.form.on('Sales Invoice', {
    setup: function(frm) {

        frm.set_query('item_code', 'packing_slip', function(doc) {

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
    qty: function(frm, cdt, cdn) {

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
    }
});



frappe.ui.form.on('Sales Invoice Packing Slip', {
    length: calculate_cbm,
    width: calculate_cbm,
    height: calculate_cbm,

    qty: function(frm, cdt, cdn) {

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