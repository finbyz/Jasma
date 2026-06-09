frappe.ui.form.on("Purchase Order Item", {
    item_code: function(frm, cdt, cdn) {

        if (!frm.doc.is_subcontracted) return;

        let row = locals[cdt][cdn];

        // Prevent re-processing after item_code becomes service_item
        if (row.fg_item) return;

        if (!row.item_code) return;

        let original_item = row.item_code;

        frappe.db.get_value(
            "Item",
            original_item,
            "service_item"
        ).then(r => {

            let service_item = r.message?.service_item;

            // Store original FG Item only once
            frappe.model.set_value(cdt, cdn, "fg_item", original_item);
            frappe.model.set_value(cdt, cdn, "fg_item_qty", row.qty);

            if (service_item && original_item !== service_item) {
                frappe.model.set_value(
                    cdt,
                    cdn,
                    "item_code",
                    service_item
                );
            } else if (!service_item) {
                frappe.model.set_value(
                    cdt,
                    cdn,
                    "item_code",
                    ""
                );
            }
        });
    }
});


frappe.ui.form.on("Purchase Order", {

    is_subcontracted: function(frm) {

        if (!frm.doc.is_subcontracted) return;

        setTimeout(() => {

            (frm.doc.items || []).forEach(function(row) {

                if (!row.item_code) return;

                let original_item = row.item_code;

                frappe.model.set_value(
                    row.doctype,
                    row.name,
                    "fg_item_qty",
                    row.qty
                );

                if (!row.fg_item) {
                    frappe.model.set_value(
                        row.doctype,
                        row.name,
                        "fg_item",
                        original_item
                    );
                }

                frappe.db.get_value(
                    "Item",
                    original_item,
                    "service_item"
                ).then(r => {

                    let service_item = r.message?.service_item;

                    if (service_item) {
                        frappe.model.set_value(
                            row.doctype,
                            row.name,
                            "item_code",
                            service_item
                        );
                    } else {
                        frappe.model.set_value(
                            row.doctype,
                            row.name,
                            "item_code",
                            ""
                        );
                        frappe.model.set_value(
                            row.doctype,
                            row.name,
                            "item_name",
                            ""
                        );
                    }
                });

            });

        }, 1000);
    }
// });
// });


    // is_subcontracted: function (frm) {
    //     if (frm.doc.is_subcontracted) {

    //         // Delay execution by 1 second (1000 ms)
    //         setTimeout(() => {
    //             (frm.doc.items || []).forEach(function (row) {
    //                 frappe.model.set_value(row.doctype, row.name, "fg_item_qty", row.qty);
    //             });
    //         }, 1000);

    //     }
    // }
    // refresh(frm) {
    //     toggle_delivery_terms_mandatory(frm);
	// },
	// set_warehouse(frm) {
	// 	toggle_delivery_terms_mandatory(frm);
	// },
    // setup(frm) {

	// 	frm.set_query("item_code", "delivery_schedule", function () {

	// 		let item_codes = [];

	// 		(frm.doc.items || []).forEach(row => {
	// 			if (row.item_code) {
	// 				item_codes.push(row.item_code);
	// 			}
	// 		});

	// 		return {
	// 			filters: [
	// 				["Item", "name", "in", item_codes]
	// 			]
	// 		};
	// 	});

	// },
    // onload(frm) {

	// 	frm.fields_dict["delivery_schedule"].grid.get_field("item_code").get_query =
	// 		function(doc, cdt, cdn) {

	// 			let item_codes = [];

	// 			(doc.items || []).forEach(d => {
	// 				if (d.item_code) {
	// 					item_codes.push(d.item_code);
	// 				}
	// 			});

	// 			return {
	// 				filters: [
	// 					["Item", "name", "in", item_codes]
	// 				]
	// 			};
	// 		};
	// }

});




// function toggle_delivery_terms_mandatory(frm) {

// 	if (frm.doc.set_warehouse) {
// 		frm.set_df_property("delivery_terms", "reqd", 0);
// 	} else {
// 		frm.set_df_property("delivery_terms", "reqd", 1);
// 	}

// 	frm.refresh_field("delivery_terms");
// }