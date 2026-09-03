frappe.ui.form.on("Subcontracting Receipt", {
	refresh(frm) {
		setTimeout(() => {
			frm.remove_custom_button(__("Quality Inspection(s)"), __("Create"));
			frm.remove_custom_button(__("QC Report"), __("Create"));

			if (!frm.is_new() && frm.doc.docstatus === 0) {
				frm.add_custom_button(
					__("QC Report"),
					function () {
						make_qc_report(frm);
					},
					__("Create")
				);
			}
		}, 500);
	},supplier(frm) {
		if (frm.doc.supplier) {

			frappe.db.get_doc("Supplier", frm.doc.supplier)
				.then((supplier) => {

					// Accepted Warehouse
					if (supplier.accepted_warehouse) {
						frm.set_value(
							"set_warehouse",
							supplier.accepted_warehouse
						);
					}

					// Rejected Warehouse
					if (supplier.rejected_warehoue) {
						frm.set_value(
							"rejected_warehouse",
							supplier.rejected_warehoue
						);
					}

					if (supplier.rejected_warehoue) {
						frm.set_value(
							"supplier_warehouse",
							supplier.job_worker_warehouse
						);
					}
				});
		}
	}
});

function make_qc_report(frm) {
	let data = [];

	const dialog = new frappe.ui.Dialog({
		title: __("Select Items for QC Report"),
		size: "extra-large",
		fields: [
			{
				label: "Items",
				fieldtype: "Table",
				fieldname: "items",
				cannot_add_rows: true,
				in_place_edit: true,
				data: data,
				get_data: () => data,
				fields: [
					{
						fieldtype: "Data",
						fieldname: "docname",
						hidden: true
					},
					{
						fieldtype: "Read Only",
						fieldname: "item_code",
						label: __("Item Code"),
						in_list_view: true
					},
					{
						fieldtype: "Read Only",
						fieldname: "item_name",
						label: __("Item Name"),
						in_list_view: true
					},
					{
						fieldtype: "Read Only",
						fieldname: "item_group",
						label: __("Item Group"),
						in_list_view: true
					},
					{
						fieldtype: "Read Only",
						fieldname: "received_quantity",
						label: __("Received Quantity"),
						in_list_view: true
					},
										{
						// Editable - user can override, especially important
						// when two rows for the same item_code were merged
						fieldtype: "Float",
						fieldname: "accepted_quantity",
						label: __("Accepted Quantity"),
						in_list_view: true
					},
					{
						// Editable - user can override, especially important
						// when two rows for the same item_code were merged
						fieldtype: "Float",
						fieldname: "rejected_quantity",
						label: __("Rejected Quantity"),
						in_list_view: true
					}
				]
			}
		],
		primary_action() {
			let selected = dialog.fields_dict.items.grid.get_selected_children();

			if (!selected.length) {
				selected = dialog.get_values().items;
			}

			// Validate that accepted + rejected = received for every row
			// the user is submitting, so merged-row splits are always consistent.
			let mismatched = selected.filter((row) => {
				let accepted = flt(row.accepted_quantity);
				let rejected = flt(row.rejected_quantity);
				let received = flt(row.received_quantity);
				return Math.abs(accepted + rejected - received) > 0.0001;
			});

			if (mismatched.length) {
				frappe.msgprint({
					title: __("Quantity Mismatch"),
					indicator: "red",
					message: __(
						"Accepted Quantity + Rejected Quantity must equal Received Quantity for: {0}",
						[mismatched.map((d) => d.item_code).join(", ")]
					)
				});
				return;
			}


			frappe.call({
				method: "jasma.jasma.doc_events.subcontracting_reciept.make_qc_report",
				args: {
					docname: frm.doc.name,
					items: selected
				},
				callback: function (r) {
					if (r.message.length === 1) {
						frappe.set_route("Form", "QC Report", r.message[0]);
					} else {
						frappe.set_route("List", "QC Report");
					}
				}
			});

			dialog.hide();
		},
		primary_action_label: __("Create")
	});

	frappe.call({
		method: "frappe.client.get_list",
		args: {
			doctype: "QC Report",
			filters: {
				reference_type: "Subcontracting Receipt",
				reference_name: frm.doc.name
			},
			fields: ["item"]
		},
		callback: function (r) {
			let existing_items = r.message.map(d => d.item);
			let item_map = {};

			frm.doc.items.forEach(item => {
				if (existing_items.includes(item.item_code)) {
					return;
				}

				if (item_map[item.item_code]) {
					item_map[item.item_code].received_quantity += item.received_qty;
					item_map[item.item_code].accepted_quantity += item.received_qty;
					item_map[item.item_code]._docnames.push(item.name);
					item_map[item.item_code].docname = item_map[item.item_code]._docnames.join(", ");
				} else {
					item_map[item.item_code] = {
						docname: item.name,
						_docnames: [item.name],
						item_code: item.item_code,
						item_name: item.item_name,
						item_group: item.item_group,
						received_quantity: item.received_qty,
						accepted_quantity: item.received_qty,
						rejected_quantity: 0,
						purchase_order: item.purchase_order,
						subcontracting_order: frm.doc.subcontracting_order,
						project: frm.doc.project
					};
				}
			});

			// ← the missing step: push the aggregated rows into `data`,
			// which is what the dialog's grid actually reads from.
			data.length = 0;
			data.push(...Object.values(item_map));

			dialog.fields_dict.items.grid.refresh();

			if (!data.length) {
				frappe.msgprint(__("QC Report already generated for all items."));
			} else {
				dialog.show();
			}
		}
	});
}