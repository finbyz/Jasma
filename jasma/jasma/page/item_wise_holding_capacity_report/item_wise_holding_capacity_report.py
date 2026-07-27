# Copyright (c) 2026, FinByz Tech and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_months, flt, getdate, today


@frappe.whitelist()
def get_dashboard_data(filters=None):
	filters = frappe.parse_json(filters) if isinstance(filters, str) else (filters or {})
	filters = frappe._dict(filters)

	view = filters.get("view") or "Item Wise"
	chart2 = None

	if view == "Item Wise":
		data, chart, columns = get_item_wise(filters)
	elif view == "Customer Wise":
		data, chart, columns = get_customer_wise(filters)
	elif view == "Region":
		data, chart, columns = get_region_wise(filters)
	elif view == "Sales Person":
		data, chart, columns = get_sales_person_wise(filters)
	elif view == "Comparison":
		data, chart, columns, chart2 = get_comparison(filters)
	else:
		data, chart, columns = [], {"labels": [], "values": [], "title": "", "type": "bar"}, []

	summary = get_summary(data)

	result = {
		"view": view,
		"columns": columns,
		"data": data,
		"chart": chart,
		"summary": summary,
	}
	if chart2 is not None:
		result["chart2"] = chart2

	return result


def _date_conditions(filters, alias="si"):
	conditions = []
	values = {}
	if filters.get("from_date"):
		conditions.append(f"{alias}.posting_date >= %(from_date)s")
		values["from_date"] = filters.get("from_date")
	if filters.get("to_date"):
		conditions.append(f"{alias}.posting_date <= %(to_date)s")
		values["to_date"] = filters.get("to_date")
	return conditions, values


# ---------------------------------------------------------------------------
# 1. Item Wise — Sales Invoice, grouped by Item + Sales Person, qty/amount summed
# ---------------------------------------------------------------------------
def get_item_wise(filters):
	conditions = ["si.docstatus = 1"]
	values = {}

	dc, dv = _date_conditions(filters)
	conditions += dc
	values.update(dv)

	if filters.get("item"):
		conditions.append("sii.item_code = %(item)s")
		values["item"] = filters.get("item")

	if filters.get("sales_person"):
		conditions.append("st.sales_person = %(sales_person)s")
		values["sales_person"] = filters.get("sales_person")

	condition_str = " and ".join(conditions)

	query = f"""
		select
			sii.item_code as item_code,
			sum(sii.qty) as qty,
			sum(sii.amount) as amount,
			st.sales_person as sales_person
		from `tabSales Invoice` si
		inner join `tabSales Invoice Item` sii on sii.parent = si.name
		left join `tabSales Team` st on st.parent = si.name and st.parenttype = 'Sales Invoice'
		where {condition_str}
		group by sii.item_code, st.sales_person
		order by amount desc
	"""
	data = frappe.db.sql(query, values, as_dict=1)

	agg = {}
	for row in data:
		agg[row.item_code] = agg.get(row.item_code, 0) + flt(row.amount)
	top = sorted(agg.items(), key=lambda x: x[1], reverse=True)[:10]

	chart = {
		"title": "Top Items by Amount",
		"labels": [t[0] for t in top],
		"values": [t[1] for t in top],
		"type": "bar",
	}

	columns = [
		{"label": "Item Code", "fieldname": "item_code"},
		{"label": "Qty", "fieldname": "qty", "type": "float"},
		{"label": "Amount", "fieldname": "amount", "type": "currency"},
		{"label": "Sales Person", "fieldname": "sales_person"},
	]

	return data, chart, columns


# ---------------------------------------------------------------------------
# 2. Customer Wise — Sales Invoice, grouped by Customer + Sales Person
# ---------------------------------------------------------------------------
def get_customer_wise(filters):
	conditions = ["si.docstatus = 1"]
	values = {}

	dc, dv = _date_conditions(filters)
	conditions += dc
	values.update(dv)

	if filters.get("customer"):
		conditions.append("si.customer = %(customer)s")
		values["customer"] = filters.get("customer")

	if filters.get("sales_person"):
		conditions.append("st.sales_person = %(sales_person)s")
		values["sales_person"] = filters.get("sales_person")

	condition_str = " and ".join(conditions)

	query = f"""
		select
			si.customer as customer,
			sum(sii.qty) as qty,
			sum(sii.amount) as amount,
			st.sales_person as sales_person
		from `tabSales Invoice` si
		inner join `tabSales Invoice Item` sii on sii.parent = si.name
		left join `tabSales Team` st on st.parent = si.name and st.parenttype = 'Sales Invoice'
		where {condition_str}
		group by si.customer, st.sales_person
		order by amount desc
	"""
	data = frappe.db.sql(query, values, as_dict=1)

	agg = {}
	for row in data:
		agg[row.customer] = agg.get(row.customer, 0) + flt(row.amount)
	top = sorted(agg.items(), key=lambda x: x[1], reverse=True)[:10]

	chart = {
		"title": "Top Customers by Amount",
		"labels": [t[0] for t in top],
		"values": [t[1] for t in top],
		"type": "bar",
	}

	columns = [
		{"label": "Customer", "fieldname": "customer"},
		{"label": "Qty", "fieldname": "qty", "type": "float"},
		{"label": "Amount", "fieldname": "amount", "type": "currency"},
		{"label": "Sales Person", "fieldname": "sales_person"},
	]

	return data, chart, columns


# ---------------------------------------------------------------------------
# 3. Region — Sales Invoice, grouped by Territory
# ---------------------------------------------------------------------------
def get_region_wise(filters):
	conditions = ["si.docstatus = 1"]
	values = {}

	dc, dv = _date_conditions(filters)
	conditions += dc
	values.update(dv)

	if filters.get("territory"):
		conditions.append("si.territory = %(territory)s")
		values["territory"] = filters.get("territory")

	condition_str = " and ".join(conditions)

	query = f"""
		select
			si.territory as territory,
			sum(sii.qty) as qty,
			sum(sii.amount) as amount
		from `tabSales Invoice` si
		inner join `tabSales Invoice Item` sii on sii.parent = si.name
		where {condition_str}
		group by si.territory
		order by amount desc
	"""
	data = frappe.db.sql(query, values, as_dict=1)

	chart = {
		"title": "Territory-wise Amount",
		"labels": [(d.territory or "Not Set") for d in data][:10],
		"values": [flt(d.amount) for d in data][:10],
		"type": "donut",
	}

	columns = [
		{"label": "Territory", "fieldname": "territory"},
		{"label": "Qty", "fieldname": "qty", "type": "float"},
		{"label": "Amount", "fieldname": "amount", "type": "currency"},
	]

	return data, chart, columns


# ---------------------------------------------------------------------------
# 4. Sales Person — grouped by Sales Person only (Qty / Amount), no forced filter
# ---------------------------------------------------------------------------
def get_sales_person_wise(filters):
	conditions = ["si.docstatus = 1"]
	values = {}

	dc, dv = _date_conditions(filters)
	conditions += dc
	values.update(dv)

	if filters.get("sales_person"):
		conditions.append("st.sales_person = %(sales_person)s")
		values["sales_person"] = filters.get("sales_person")

	condition_str = " and ".join(conditions)

	query = f"""
		select
			st.sales_person as sales_person,
			sum(sii.qty) as qty,
			sum(sii.amount) as amount
		from `tabSales Invoice` si
		inner join `tabSales Invoice Item` sii on sii.parent = si.name
		inner join `tabSales Team` st on st.parent = si.name and st.parenttype = 'Sales Invoice'
		where {condition_str}
		group by st.sales_person
		order by amount desc
	"""
	data = frappe.db.sql(query, values, as_dict=1)

	chart = {
		"title": "Sales Person-wise Amount",
		"labels": [(d.sales_person or "Not Set") for d in data][:10],
		"values": [flt(d.amount) for d in data][:10],
		"type": "donut",
	}

	columns = [
		{"label": "Sales Person", "fieldname": "sales_person"},
		{"label": "Qty", "fieldname": "qty", "type": "float"},
		{"label": "Amount", "fieldname": "amount", "type": "currency"},
	]

	return data, chart, columns


# ---------------------------------------------------------------------------
# 5. Comparison — requires a Customer.
#    - Chart 1: trailing 12-month sales trend for that customer
#    - Table + Chart 2: Item x Month breakdown (Qty, Amount, Sales Person)
# ---------------------------------------------------------------------------
def _trailing_12_month_keys():
	"""Return 12 'YYYY-MM' keys ending with the current month, oldest first."""
	end = getdate(today())
	start = add_months(end.replace(day=1), -11)

	keys = []
	cur = start
	for _ in range(12):
		keys.append(cur.strftime("%Y-%m"))
		cur = add_months(cur, 1)
	return keys, start, end


def get_comparison(filters):
	columns = [
		{"label": "Month", "fieldname": "month"},
		{"label": "Item Code", "fieldname": "item_code"},
		{"label": "Sales Person", "fieldname": "sales_person"},
		{"label": "Qty", "fieldname": "qty", "type": "float"},
		{"label": "Amount", "fieldname": "amount", "type": "currency"},
	]
	empty_chart = {"title": "", "labels": [], "values": [], "type": "line"}

	if not filters.get("customer"):
		return [], empty_chart, columns, dict(empty_chart, type="bar")

	customer = filters.get("customer")
	month_keys, range_start, range_end = _trailing_12_month_keys()

	conditions = ["si.docstatus = 1", "si.customer = %(customer)s", "si.posting_date between %(range_start)s and %(range_end)s"]
	values = {"customer": customer, "range_start": range_start, "range_end": range_end}

	if filters.get("item"):
		conditions.append("sii.item_code = %(item)s")
		values["item"] = filters.get("item")

	condition_str = " and ".join(conditions)

	# --- Chart 1: trailing 12-month trend (all items combined) ---
	trend_query = f"""
		select
			date_format(si.posting_date, '%%Y-%%m') as month,
			sum(sii.amount) as amount
		from `tabSales Invoice` si
		inner join `tabSales Invoice Item` sii on sii.parent = si.name
		where {condition_str}
		group by month
	"""
	trend_rows = frappe.db.sql(trend_query, values, as_dict=1)
	trend_by_month = {r.month: flt(r.amount) for r in trend_rows}

	chart = {
		"title": f"Monthly Sales — Last 12 Months — {customer}",
		"labels": month_keys,
		"values": [trend_by_month.get(m, 0) for m in month_keys],
		"type": "line",
	}

	# --- Table + Chart 2: Item x Month x Sales Person breakdown ---
	detail_query = f"""
		select
			date_format(si.posting_date, '%%Y-%%m') as month,
			sii.item_code as item_code,
			st.sales_person as sales_person,
			sum(sii.qty) as qty,
			sum(sii.amount) as amount
		from `tabSales Invoice` si
		inner join `tabSales Invoice Item` sii on sii.parent = si.name
		left join `tabSales Team` st on st.parent = si.name and st.parenttype = 'Sales Invoice'
		where {condition_str}
		group by month, sii.item_code, st.sales_person
		order by month, amount desc
	"""
	data = frappe.db.sql(detail_query, values, as_dict=1)

	item_totals = {}
	for row in data:
		item_totals[row.item_code] = item_totals.get(row.item_code, 0) + flt(row.amount)
	top_items = sorted(item_totals.items(), key=lambda x: x[1], reverse=True)[:10]

	chart2 = {
		"title": f"Item-wise Breakdown (Last 12 Months) — {customer}",
		"labels": [t[0] for t in top_items],
		"values": [t[1] for t in top_items],
		"type": "bar",
	}

	return data, chart, columns, chart2


def get_summary(data):
	total_qty = sum(flt(d.get("qty")) for d in data)
	total_amount = sum(flt(d.get("amount")) for d in data)

	return [
		{"value": len(data), "label": "Total Rows", "datatype": "Int"},
		{"value": total_qty, "label": "Total Quantity", "datatype": "Float"},
		{"value": total_amount, "label": "Total Amount", "datatype": "Currency"},
	]