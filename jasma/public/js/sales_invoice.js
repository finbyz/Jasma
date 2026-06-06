frappe.ui.form.on('Sales Invoice', {

    refresh(frm) {

        let currency = frm.doc.currency || '';

        frm.set_df_property("total_value", "options", "currency");
        frm.set_df_property("total_fob_values", "options", "currency");

        frm.set_df_property(
            "total_value",
            "label",
            `Total Value (${currency})`
        );

        frm.set_df_property(
            "total_fob_values",
            "label",
            `Total FOB Value (${currency})`
        );

        frm.refresh_fields([
            "total_value",
            "total_fob_values"
        ]);
    },

    onload(frm) {

        let currency = frm.doc.currency || '';

        frm.set_df_property(
            "total_value",
            "label",
            `Total Value (${currency})`
        );

        frm.set_df_property(
            "total_fob_values",
            "label",
            `Total FOB Value (${currency})`
        );
    },

    currency(frm) {

        let currency = frm.doc.currency || '';

        frm.set_df_property(
            "total_value",
            "label",
            `Total Value (${currency})`
        );

        frm.set_df_property(
            "total_fob_values",
            "label",
            `Total FOB Value (${currency})`
        );
    },

    validate(frm) {

        frm.set_value(
            "total_value",
            flt(frm.doc.net_total)
        );

        frm.set_value(
            "total_fob_values",
            flt(frm.doc.net_total)
            - flt(frm.doc.freight)
            - flt(frm.doc.insurance)
        );
    },

    setup(frm) {

        frm.set_query(
            "item_code",
            "packing_slip",
            function (doc) {

                let item_list = [];

                (doc.items || []).forEach(row => {

                    if (row.item_code) {
                        item_list.push(row.item_code);
                    }

                });

                return {
                    filters: {
                        name: ["in", item_list]
                    }
                };

            }
        );
    }

});



frappe.ui.form.on(
    "Sales Invoice Packing Slip",
    {

        length: calculate_cbm,
        width: calculate_cbm,
        height: calculate_cbm,

        box_from: calculate_total_box,
        box_to: calculate_total_box,

        qty(frm, cdt, cdn) {

            let row = locals[cdt][cdn];

            // TOTAL VALIDATION

            let item_total = 0;
            let packing_total = 0;

            (frm.doc.items || []).forEach(d => {
                item_total += flt(d.qty);
            });

            (frm.doc.packing_slip || []).forEach(d => {
                packing_total += flt(d.qty);
            });

            if (packing_total > item_total) {

                frappe.model.set_value(
                    cdt,
                    cdn,
                    "qty",
                    0
                );

                frappe.throw(
                    __("Packing Qty cannot exceed Item Total Qty")
                );

                return;
            }


            // ITEM WISE VALIDATION

            if (row.item_code) {

                let item_qty = 0;
                let packing_qty = 0;

                (frm.doc.items || []).forEach(d => {

                    if (
                        d.item_code === row.item_code
                    ) {
                        item_qty += flt(d.qty);
                    }

                });

                (frm.doc.packing_slip || []).forEach(d => {

                    if (
                        d.item_code === row.item_code
                    ) {
                        packing_qty += flt(d.qty);
                    }

                });

                if (
                    packing_qty > item_qty
                ) {

                    frappe.model.set_value(
                        cdt,
                        cdn,
                        "qty",
                        0
                    );

                    frappe.throw(
                        __(
                            `Packing Qty for Item ${row.item_code} cannot exceed ${item_qty}`
                        )
                    );

                    return;
                }
            }
        },



        packing_slip_add(frm) {

            // Prevent accidental rate reset

            (frm.doc.items || []).forEach(item => {

                if (
                    flt(item.rate) === 0 &&
                    flt(item.price_list_rate)
                ) {

                    frappe.model.set_value(
                        item.doctype,
                        item.name,
                        "rate",
                        item.price_list_rate
                    );

                }

            });

            frm.refresh_field("items");
        }

    }
);



function calculate_cbm(frm, cdt, cdn) {

    let row = locals[cdt][cdn];

    let l = flt(row.length);
    let w = flt(row.width);
    let h = flt(row.height);

    let cbm =
        (l * w * h) /
        1000000000;

    frappe.model.set_value(
        cdt,
        cdn,
        "cbm",
        cbm
    );
}



function calculate_total_box(
    frm,
    cdt,
    cdn
) {

    let row = locals[cdt][cdn];

    let box_from =
        cint(row.box_from);

    let box_to =
        cint(row.box_to);

    let total = 0;

    if (
        box_from &&
        box_to >= box_from
    ) {

        total =
            (
                box_to -
                box_from
            ) + 1;
    }

    frappe.model.set_value(
        cdt,
        cdn,
        "total_box",
        total
    );
}