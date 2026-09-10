# Copyright (c) 2026, Finbyz tech and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt

import erpnext
from erpnext.accounts.report.item_wise_sales_register.item_wise_sales_register import get_tax_accounts


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = get_columns(filters)
	# columns is passed by reference into get_data -> get_purchase_data, which
	# appends the dynamic GST-wise tax columns to it (Purchase rows only)
	data = get_data(filters, columns)
	return columns, data


# ---------------------------------------------------------------------
# COLUMNS
# ---------------------------------------------------------------------
def get_columns(filters):
	group_by = filters.get("group_by")
	txn_type = filters.get("type") or "All"

	columns = []

	if group_by != "Item":
		columns += [
			{
				"label": _("Item Code"),
				"fieldname": "item_code",
				"fieldtype": "Link",
				"options": "Item",
				"width": 120,
			},
			{"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 120},
		]

	if group_by not in ("Item", "Item Group"):
		columns.append(
			{
				"label": _("Item Group"),
				"fieldname": "item_group",
				"fieldtype": "Link",
				"options": "Item Group",
				"width": 120,
			}
		)

	if txn_type == "All":
		columns.append(
			{"label": _("Type"), "fieldname": "transaction_type", "fieldtype": "Data", "width": 100}
		)

	columns += [
		{"label": _("Voucher Type"), "fieldname": "voucher_type", "fieldtype": "Data", "width": 130},
		{
			"label": _("Voucher No"),
			"fieldname": "voucher_no",
			"fieldtype": "Dynamic Link",
			"options": "voucher_type",
			"width": 160,
		},
		{"label": _("Posting Date"), "fieldname": "posting_date", "fieldtype": "Date", "width": 100},
	]

	# supplier columns are irrelevant for pure Manufacturing, and are dropped
	# entirely from the "group by Supplier" view of the report
	if txn_type != "Manufacturing" and group_by != "Supplier":
		columns += [
			{
				"label": _("Supplier"),
				"fieldname": "supplier",
				"fieldtype": "Link",
				"options": "Supplier",
				"width": 120,
			},
			{"label": _("Supplier Name"), "fieldname": "supplier_name", "fieldtype": "Data", "width": 120},
		]

	# Expense Account only has meaning for Purchase Invoice rows (it comes
	# from the PI item / company's stock-received-but-not-billed account).
	# Manufacturing and Subcontracting rows will simply have this blank.
	if txn_type in ("All", "Purchase"):
		columns.append(
			{
				"label": _("Expense Account"),
				"fieldname": "expense_account",
				"fieldtype": "Link",
				"options": "Account",
				"width": 140,
			}
		)

	columns += [
		{
			"label": _("Company"),
			"fieldname": "company",
			"fieldtype": "Link",
			"options": "Company",
			"width": 100,
		},
		{
			"label": _("Warehouse"),
			"fieldname": "warehouse",
			"fieldtype": "Link",
			"options": "Warehouse",
			"width": 120,
		},
		{"label": _("Qty"), "fieldname": "qty", "fieldtype": "Float", "width": 90},
		{"label": _("UOM"), "fieldname": "uom", "fieldtype": "Link", "options": "UOM", "width": 80},
		{
			"label": _("Rate"),
			"fieldname": "rate",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 100,
		},
		{
			"label": _("Amount"),
			"fieldname": "amount",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 110,
		},
		{"label": _("Currency"), "fieldname": "currency", "fieldtype": "Data", "width": 1, "hidden": 1},
	]

	if group_by:
		columns.append(
			{"label": _("% Of Grand Total"), "fieldname": "percent_gt", "fieldtype": "Float", "width": 100}
		)

	return columns


# ---------------------------------------------------------------------
# DATA
# ---------------------------------------------------------------------
def get_data(filters, columns):
	txn_type = filters.get("type") or "All"
	data = []

	# When a Supplier filter is applied, Manufacturing has nothing to
	# contribute (a manufactured item has no supplier), so it is skipped.
	include_manufacturing = txn_type in ("All", "Manufacturing") and not filters.get("supplier")

	if txn_type in ("All", "Purchase"):
		data += get_purchase_data(filters, columns)

	if include_manufacturing:
		data += get_manufacturing_data(filters)

	if txn_type in ("All", "Subcontracting"):
		data += get_subcontracting_data(filters)

	if filters.get("group_by"):
		data = build_group_by_view(data, filters.get("group_by"))

	return data


def get_purchase_data(filters, columns):
	"""Item-wise data sourced from submitted Purchase Invoices.

	Also computes the same GST-wise tax rate/amount breakup and Expense
	Account shown on the standard Item-wise Purchase Register. Both are
	Purchase-Invoice-specific (tax breakup comes from Purchase Taxes and
	Charges; Expense Account has no equivalent on a Stock Entry or a
	Subcontracting Receipt), so Manufacturing and Subcontracting rows are
	simply left without these fields -> blank cells for those rows.
	"""
	pi = frappe.qb.DocType("Purchase Invoice")
	pii = frappe.qb.DocType("Purchase Invoice Item")

	query = (
		frappe.qb.from_(pi)
		.join(pii)
		.on(pi.name == pii.parent)
		.select(
			pii.name,
			pii.parent,
			pii.item_code,
			pii.item_name,
			pii.item_group,
			pi.posting_date,
			pi.supplier,
			pi.supplier_name,
			pi.company,
			pii.warehouse,
			pii.stock_qty.as_("qty"),
			pii.stock_uom.as_("uom"),
			pii.base_net_amount,
			pi.base_net_total,
			pii.expense_account,
			pi.unrealized_profit_loss_account,
		)
		.where(pi.docstatus == 1)
		.where(pi.is_subcontracted == 0)
	)

	query = apply_common_filters(query, pi, pii, filters, supplier_field=pi.supplier)
	rows = query.run(as_dict=True)

	if not rows:
		return []

	aii_account_map = get_aii_accounts()

	# company_currency is required by get_tax_accounts (used for column
	# formatting). Use the Company filter if set; otherwise fall back to
	# the first matched row's company (e.g. Type=All, no Company filter).
	company_currency = erpnext.get_company_currency(filters.get("company") or rows[0].company)

	itemised_tax, tax_columns = get_tax_accounts(
		rows,
		columns,
		company_currency,
		doctype="Purchase Invoice",
		tax_doctype="Purchase Taxes and Charges",
	)
	default_taxes = {}
	for tax in tax_columns:
		default_taxes[f"{tax}_rate"] = 0
		default_taxes[f"{tax}_amount"] = 0

	data = []
	for d in rows:
		expense_account = (
			d.unrealized_profit_loss_account or d.expense_account or aii_account_map.get(d.company)
		)

		row = {
			"item_code": d.item_code,
			"item_name": d.item_name,
			"item_group": d.item_group,
			"transaction_type": "Purchase",
			"voucher_type": "Purchase Invoice",
			"voucher_no": d.parent,
			"posting_date": d.posting_date,
			"supplier": d.supplier,
			"supplier_name": d.supplier_name,
			"expense_account": expense_account,
			"company": d.company,
			"warehouse": d.warehouse,
			"qty": d.qty,
			"uom": d.uom,
			"amount": d.base_net_amount,
			"rate": d.base_net_amount / d.qty if d.qty else d.base_net_amount,
			"currency": frappe.get_cached_value("Company", d.company, "default_currency"),
		}

		row.update(default_taxes.copy())
		for tax, details in itemised_tax.get(d.name, {}).items():
			row[f"{tax}_rate"] = details.get("tax_rate", 0)
			row[f"{tax}_amount"] = details.get("tax_amount", 0)

		data.append(row)

	return data


def get_aii_accounts():
	"""company -> stock_received_but_not_billed account, for the Expense
	Account fallback (same lookup the standard Item-wise Purchase Register
	uses)."""
	return dict(frappe.db.sql("select name, stock_received_but_not_billed from tabCompany"))


def get_manufacturing_data(filters):
	"""Item-wise data sourced from submitted 'Manufacture' Stock Entries.

	Only the finished-goods (target warehouse) rows are picked up, since
	those represent the item actually produced by the manufacturing
	transaction; raw-material consumption rows are intentionally excluded
	to avoid double counting the same voucher.
	"""
	se = frappe.qb.DocType("Stock Entry")
	sed = frappe.qb.DocType("Stock Entry Detail")
	Item = frappe.qb.DocType("Item")

	query = (
		frappe.qb.from_(se)
		.join(sed)
		.on(se.name == sed.parent)
		.left_join(Item)
		.on(sed.item_code == Item.name)
		.select(
			sed.item_code,
			sed.item_name,
			Item.item_group.as_("item_group"),
			se.name.as_("voucher_no"),
			se.posting_date,
			se.company,
			sed.t_warehouse.as_("warehouse"),
			sed.qty,
			sed.uom,
			sed.amount,
		)
		.where(se.docstatus == 1)
		.where(se.purpose == "Manufacture")
		.where(sed.t_warehouse.isnotnull())
		.where(sed.t_warehouse != "")
	)

	query = apply_common_filters(
		query, se, sed, filters, supplier_field=None, item_group_field=Item.item_group
	)
	rows = query.run(as_dict=True)

	for row in rows:
		row["transaction_type"] = "Manufacturing"
		row["voucher_type"] = "Stock Entry"
		row["supplier"] = None
		row["supplier_name"] = None
		row["rate"] = row["amount"] / row["qty"] if row.get("qty") else row["amount"]
		row["currency"] = frappe.get_cached_value("Company", row["company"], "default_currency")

	return rows


def get_subcontracting_data(filters):
	"""Item-wise data sourced from submitted Subcontracting Receipts."""
	scr = frappe.qb.DocType("Subcontracting Receipt")
	scri = frappe.qb.DocType("Subcontracting Receipt Item")
	Item = frappe.qb.DocType("Item")

	query = (
		frappe.qb.from_(scr)
		.join(scri)
		.on(scr.name == scri.parent)
		.left_join(Item)
		.on(scri.item_code == Item.name)
		.select(
			scri.item_code,
			scri.item_name,
			Item.item_group.as_("item_group"),
			scr.name.as_("voucher_no"),
			scr.posting_date,
			scr.supplier,
			scr.supplier_name,
			scr.company,
			scri.warehouse,
			scri.qty,
			scri.stock_uom,
			scri.amount,
		)
		.where(scr.docstatus == 1)
	)

	query = apply_common_filters(
		query, scr, scri, filters, supplier_field=scr.supplier, item_group_field=Item.item_group
	)
	rows = query.run(as_dict=True)

	for row in rows:
		row["transaction_type"] = "Subcontracting"
		row["voucher_type"] = "Subcontracting Receipt"
		row["rate"] = row["amount"] / row["qty"] if row.get("qty") else row["amount"]
		row["currency"] = frappe.get_cached_value("Company", row["company"], "default_currency")

	return rows


def apply_common_filters(query, parent, child, filters, supplier_field, item_group_field=None):
	if filters.get("from_date"):
		query = query.where(parent.posting_date >= filters.get("from_date"))

	if filters.get("to_date"):
		query = query.where(parent.posting_date <= filters.get("to_date"))

	if filters.get("item_code"):
		query = query.where(child.item_code == filters.get("item_code"))

	if filters.get("item_group"):
		group_field = item_group_field if item_group_field is not None else child.item_group
		query = query.where(group_field == filters.get("item_group"))

	if filters.get("company"):
		query = query.where(parent.company == filters.get("company"))

	if filters.get("supplier") and supplier_field is not None:
		query = query.where(supplier_field == filters.get("supplier"))

	return query


# ---------------------------------------------------------------------
# GROUP BY / DRILL-DOWN
# ---------------------------------------------------------------------
def build_group_by_view(data, group_by):
	"""Re-shape the flat row list into a grouped view: a bold subtotal row
	per group value, followed by that group's detail rows (drill-down),
	and a final grand total row. Mirrors the indentation/bold pattern used
	by the standard Item-wise Purchase/Sales Register reports.
	"""
	field_map = {"Item": "item_code", "Item Group": "item_group", "Supplier": "supplier"}
	group_field = field_map.get(group_by)
	if not group_field:
		return data

	grand_total = flt(sum(flt(d.get("amount")) for d in data))

	groups = {}
	order = []
	for row in data:
		key = row.get(group_field) or _("Not Set")
		if key not in groups:
			groups[key] = []
			order.append(key)
		groups[key].append(row)

	result = []
	for key in order:
		rows = groups[key]
		group_total = flt(sum(flt(r.get("amount")) for r in rows))
		group_qty = flt(sum(flt(r.get("qty")) for r in rows))

		total_row = {
			group_field: key,
			"qty": group_qty,
			"amount": group_total,
			"percent_gt": flt(group_total / grand_total * 100) if grand_total else 0,
			"bold": 1,
		}
		if group_field == "supplier":
			total_row["supplier_name"] = rows[0].get("supplier_name")
		result.append(total_row)

		for row in rows:
			row["percent_gt"] = flt(flt(row.get("amount")) / grand_total * 100) if grand_total else 0
			result.append(row)

	result.append({})
	result.append(
		{
			group_field: _("Grand Total"),
			"amount": grand_total,
			"percent_gt": 100 if grand_total else 0,
			"bold": 1,
		}
	)

	return result