frappe.ui.form.on("Stock Entry", {
	refresh(frm) {
		if (frm.doc.docstatus === 0 && !frm.doc.subcontracting_inward_order) {
			frm.add_custom_button(
				__("Purchase Receipt"),
				function () {
					erpnext.utils.map_current_doc({
						method: "jasma.jasma.doc_events.purchase_reciept.make_stock_entry_from_purchase_receipt",
						source_doctype: "Purchase Receipt",
						target: frm,
						date_field: "posting_date",
						setters: {
							supplier: frm.doc.supplier || undefined,
						},
						get_query_filters: {
							docstatus: 1,
						},
					});
				},
				__("Get Items From")
			);
		}

		if (
			!frm.is_new() &&
			frm.doc.docstatus === 0 &&
			frm.doc.stock_entry_type == "Manufacture"
		) {

			// Check if any item has target warehouse
			let has_valid_item = frm.doc.items.some(item => item.t_warehouse);

			if (has_valid_item) {

				frm.add_custom_button(
					__("QC Report"),
					function () {
						make_qc_report(frm);
					},
					__("Create")
				);
			}
		}

		
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
						fieldname: "t_warehouse",
						label: __("Target Warehouse"),
						in_list_view: true
					},
					{
						fieldtype: "Read Only",
						fieldname: "qty",
						label: __("Qty"),
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
				method: "jasma.jasma.doc_events.stock_entry.make_qc_report",
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

				// Only Manufacture Stock Entry
				// Only items having Target Warehouse
				if (
					frm.doc.stock_entry_type === "Manufacture" &&
					item.t_warehouse &&
					!existing_items.includes(item.item_code)
				) {

					dialog.fields_dict.items.df.data.push({
						docname: item.name,
						item_code: item.item_code,
						item_name: item.item_name,
						t_warehouse: item.t_warehouse,
						qty: item.qty,
						project: frm.doc.project
					});
				}
			});

			dialog.fields_dict.items.grid.refresh();

			if (!dialog.fields_dict.items.df.data.length) {
				frappe.msgprint(__("No items available for QC Report."));
			} else {
				dialog.show();
			}
		}
	});
}

