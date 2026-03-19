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
	}
});