// frappe.ui.form.on("Purchase Receipt", {
// 	refresh(frm) {
// 		setTimeout(() => {
// 			frm.remove_custom_button(__("Quality Inspection(s)"), __("Create"));
// 			frm.remove_custom_button(__("QC Report"), __("Create"));

// 			if (!frm.is_new() && frm.doc.docstatus === 0) {
// 				frm.add_custom_button(
// 					__("QC Report"),
// 					function () {
// 						frappe.new_doc("QC Report");
// 					},
// 					__("Create")
// 				);
// 			}
// 		}, 500);
// 	}
// });


frappe.ui.form.on("Purchase Receipt", {
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
	}
});

function make_qc_report(frm) {
	let data = [];

	const dialog = new frappe.ui.Dialog({
		title: __("Select Items for QC Report"),
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
					}
				]
			}
		],
		primary_action() {
			let selected = dialog.fields_dict.items.grid.get_selected_children();

			if (!selected.length) {
				selected = dialog.get_values().items;
			}

			frappe.call({
				method: "jasma.jasma.doc_events.purchase_reciept.make_qc_report",
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
				reference_type: frm.doc.name
			},
			fields: ["item"]
		},
		callback: function (r) {
			let existing_items = r.message.map(d => d.item);

			frm.doc.items.forEach(item => {
				if (!existing_items.includes(item.item_code)) {
					dialog.fields_dict.items.df.data.push({
						docname: item.name,
						item_code: item.item_code,
						item_name: item.item_name,
						item_group: item.item_group,
						received_quantity : item.received_qty,
						purchase_order : item.purchase_order,
						project : frm.doc.project
					});
				}
			});

			dialog.fields_dict.items.grid.refresh();

			if (!dialog.fields_dict.items.df.data.length) {
				frappe.msgprint(__("QC Report already generated for all items."));
			} else {
				dialog.show();
			}
		}
	});
}