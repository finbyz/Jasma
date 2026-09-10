// Copyright (c) 2026, Finbyz tech and contributors
// For license information, please see license.txt

frappe.query_reports["Item-wise Purchase Register For Subcontracting"] = {
	filters: [
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -1),
			reqd: 1,
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1,
		},
		{
			fieldname: "type",
			label: __("Type"),
			fieldtype: "Select",
			options: ["All", "Purchase", "Manufacturing", "Subcontracting"],
			default: "All",
			reqd: 1,
			on_change: function (query_report) {
				update_group_by_options();
				toggle_supplier_filter();
				query_report.refresh();
			},
		},
		{
			fieldname: "item_code",
			label: __("Item"),
			fieldtype: "Link",
			options: "Item",
		},
		{
			fieldname: "item_group",
			label: __("Item Group"),
			fieldtype: "Link",
			options: "Item Group",
		},
		{
			fieldname: "supplier",
			label: __("Supplier"),
			fieldtype: "Link",
			options: "Supplier",
		},
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "group_by",
			label: __("Group By"),
			fieldtype: "Select",
			options: ["", "Item", "Item Group"],
		},
	],

	formatter: function (value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (data && data.bold) {
			value = value.bold();
		}
		return value;
	},

	onload: function (report) {
		update_group_by_options();
		toggle_supplier_filter();
	},
};

// Group By options available per Type, per the report spec:
// All / Manufacturing -> Item, Item Group only (no Supplier)
// Purchase / Subcontracting -> Item, Item Group, Supplier
const GROUP_BY_OPTIONS = {
	All: ["", "Item", "Item Group"],
	Purchase: ["", "Item", "Item Group", "Supplier"],
	Manufacturing: ["", "Item", "Item Group"],
	Subcontracting: ["", "Item", "Item Group", "Supplier"],
};

function update_group_by_options() {
	const type = frappe.query_report.get_filter_value("type") || "All";
	const group_by_filter = frappe.query_report.get_filter("group_by");
	if (!group_by_filter) return;

	const options = GROUP_BY_OPTIONS[type] || GROUP_BY_OPTIONS["All"];
	group_by_filter.df.options = options;
	group_by_filter.refresh();

	// if the currently selected Group By is no longer valid for this
	// Type (e.g. was "Supplier", Type switched to "Manufacturing"),
	// reset it back to blank rather than leaving a stale/invalid value
	if (!options.includes(group_by_filter.get_value())) {
		group_by_filter.set_value("");
	}
}

function toggle_supplier_filter() {
	const type = frappe.query_report.get_filter_value("type") || "All";
	const supplier_filter = frappe.query_report.get_filter("supplier");
	if (!supplier_filter) return;

	if (type === "Manufacturing") {
		supplier_filter.set_value("");
		supplier_filter.toggle(false);
	} else {
		supplier_filter.toggle(true);
	}
}