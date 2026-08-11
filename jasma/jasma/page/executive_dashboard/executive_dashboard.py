# jasma/jasma/page/executive_dashboard/executive_dashboard.py

"""
Executive Dashboard Backend
STEP 1: Only Total Sales and Sales Orders are dynamic
Everything else uses static mock data
"""

import frappe
from frappe.utils import (
    getdate, add_days, add_months, add_years, get_first_day, get_last_day, today, flt, cint,
)

# ============================================================
# DATE UTILITY
# ============================================================

def get_current_fiscal_year_range(today_date):
    """
    (from_date, to_date) of the Fiscal Year that contains `today_date`,
    falling back to an Apr-Mar year when no Fiscal Year record covers it.
    """
    fy = frappe.db.get_value(
        "Fiscal Year",
        {"year_start_date": ["<=", today_date], "year_end_date": [">=", today_date]},
        ["year_start_date", "year_end_date"],
        as_dict=True,
    )
    if fy:
        return getdate(fy.year_start_date), getdate(fy.year_end_date)

    # Fallback: Apr-Mar fiscal year
    if today_date.month >= 4:
        from_date = today_date.replace(month=4, day=1)
    else:
        from_date = today_date.replace(year=today_date.year - 1, month=4, day=1)
    return from_date, today_date

def get_date_range(period_preset, custom_from_date=None, custom_to_date=None):
    """
    Resolve a (from_date, to_date) pair for the chosen preset.
    """
    today_date = getdate(today())

    if period_preset in ("custom", "Custom Range") and custom_from_date and custom_to_date:
        return getdate(custom_from_date), getdate(custom_to_date)

    if period_preset == "weekly":
        return add_days(today_date, -7), today_date

    if period_preset == "monthly":
        return get_first_day(today_date), get_last_day(today_date)

    if period_preset == "quarterly":
        # Rolling trailing quarter - the last 3 full calendar months, ending
        # with the current month (e.g. today in July -> May, Jun, Jul) -
        # not a fixed Apr-Jun/Jul-Sep fiscal-quarter block.
        quarter_start = add_months(get_first_day(today_date), -2)
        return quarter_start, get_last_day(today_date)

    if period_preset in ("previous_fy", "Previous Financial Year"):
        cur_fy_start, _ = get_current_fiscal_year_range(today_date)
        prev_fy = frappe.db.get_value(
            "Fiscal Year",
            {"year_end_date": add_days(cur_fy_start, -1)},
            ["year_start_date", "year_end_date"],
            as_dict=True,
        )
        if prev_fy:
            return getdate(prev_fy.year_start_date), getdate(prev_fy.year_end_date)

        # Fallback: shift the current fiscal year back by exactly one year.
        return add_years(cur_fy_start, -1), add_days(cur_fy_start, -1)

    # yearly ("This Financial Year") -> the Fiscal Year that contains today
    return get_current_fiscal_year_range(today_date)

def get_previous_date_range(from_date, to_date):
    """
    Given a resolved (from_date, to_date), return the immediately preceding
    window of the same length. Used for period-over-period comparisons
    (this year vs previous year, this week vs previous week, etc.).
    """
    from_date = getdate(from_date)
    to_date = getdate(to_date)
    duration = (to_date - from_date).days
    prev_to = add_days(from_date, -1)
    prev_from = add_days(prev_to, -duration)
    return prev_from, prev_to

def fmt_inr(value):
    """Format a number as Indian Cr / L currency string."""
    value = value or 0
    abs_value = abs(value)
    if abs_value >= 1e7:
        return "₹ {:.2f} Cr".format(value / 1e7)
    if abs_value >= 1e5:
        return "₹ {:.2f} L".format(value / 1e5)
    return "₹ {:,.0f}".format(value)

def fmt_money(value, symbol="₹"):
    """Format a number as a compact K/M/B currency string with the given symbol."""
    value = value or 0
    abs_value = abs(value)
    if abs_value >= 1e9:
        return "{0} {1:.2f}B".format(symbol, value / 1e9)
    if abs_value >= 1e6:
        return "{0} {1:.2f}M".format(symbol, value / 1e6)
    if abs_value >= 1e3:
        return "{0} {1:.2f}K".format(symbol, value / 1e3)
    return "{0} {1:,.0f}".format(symbol, value)


def fmt_inr_full(value):
    """Format a number as a full INR currency string without K/M/Cr abbreviations."""
    value = value or 0
    if float(value).is_integer():
        return "₹ {:,}".format(int(round(value)))
    return "₹ {:,.2f}".format(value)


def fmt_money_full(value, symbol="₹"):
    """Format a number as a full currency string without K/M/B abbreviations."""
    value = value or 0
    if float(value).is_integer():
        return "{0} {1:,}".format(symbol, int(round(value)))
    return "{0} {1:,.2f}".format(symbol, value)

# ============================================================
# CARD 1: TOTAL SALES (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_total_sales(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Returns Total Sales (Net Total) from submitted Sales Invoices only.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = "docstatus = 1 AND posting_date BETWEEN %(from_date)s AND %(to_date)s"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND company = %(company)s"
        params["company"] = company

    net_total = frappe.db.sql(
        f"""
        SELECT SUM(base_net_total)
        FROM `tabSales Invoice`
        WHERE {conditions}
        """,
        params,
    )[0][0] or 0

    filters = {
        "docstatus": 1,
        "posting_date": ["between", [from_date, to_date]],
    }
    if company:
        filters["company"] = company

    invoice_count = frappe.db.count("Sales Invoice", filters=filters)

    return {
        "net_total": net_total,
        "net_total_fmt": fmt_inr(net_total),
        "invoice_count": invoice_count,
        "from_date": str(from_date),
        "to_date": str(to_date),
        "period_preset": period_preset,
        "company": company,
    }


@frappe.whitelist()
def get_total_sales_order(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Returns Total Sales Order Value (Net Total) from submitted Sales
    Orders only. Mirrors get_total_sales but sourced from Sales Order /
    transaction_date instead of Sales Invoice / posting_date.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = "docstatus = 1 AND transaction_date BETWEEN %(from_date)s AND %(to_date)s"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND company = %(company)s"
        params["company"] = company

    net_total = frappe.db.sql(
        f"""
        SELECT SUM(base_net_total)
        FROM `tabSales Order`
        WHERE {conditions}
        """,
        params,
    )[0][0] or 0

    filters = {
        "docstatus": 1,
        "transaction_date": ["between", [from_date, to_date]],
    }
    if company:
        filters["company"] = company

    order_count = frappe.db.count("Sales Order", filters=filters)

    return {
        "net_total": net_total,
        "net_total_fmt": fmt_inr(net_total),
        "order_count": order_count,
        "from_date": str(from_date),
        "to_date": str(to_date),
        "period_preset": period_preset,
        "company": company,
    }
# ============================================================
# MONTHLY REVENUE TREND (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_monthly_revenue_trend(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Month-wise Net Total from submitted Sales Invoices (base_net_total),
    same source data as the standard Sales Analytics report and the
    Total Sales card. Every calendar month between from_date and to_date
    is included (zero-filled) so the trend chart never has gaps.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = "docstatus = 1 AND posting_date BETWEEN %(from_date)s AND %(to_date)s"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT
            DATE_FORMAT(posting_date, '%%Y-%%m') AS month_key,
            SUM(base_net_total) AS net_total
        FROM `tabSales Invoice`
        WHERE {conditions}
        GROUP BY month_key
        """,
        params,
        as_dict=True,
    )
    totals_by_month = {r.month_key: flt(r.net_total) for r in rows}

    months = []
    cursor = get_first_day(from_date)
    last_month = get_first_day(to_date)
    while cursor <= last_month:
        months.append(cursor)
        cursor = add_months(cursor, 1)

    items = [
        {
            "month": m.strftime("%b"),
            "val": totals_by_month.get(m.strftime("%Y-%m"), 0),
            "revenue": totals_by_month.get(m.strftime("%Y-%m"), 0),
            "revenue_fmt": fmt_inr(totals_by_month.get(m.strftime("%Y-%m"), 0)),
        }
        for m in months
    ]

    return items

@frappe.whitelist()
def get_monthly_sales_order_trend(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Month-wise Net Total from submitted Sales Orders (base_net_total),
    using transaction_date and the same ranged month buckets as the
    Revenue Trend chart.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = "docstatus = 1 AND transaction_date BETWEEN %(from_date)s AND %(to_date)s"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT
            DATE_FORMAT(transaction_date, '%%Y-%%m') AS month_key,
            SUM(base_net_total) AS net_total
        FROM `tabSales Order`
        WHERE {conditions}
        GROUP BY month_key
        """,
        params,
        as_dict=True,
    )
    totals_by_month = {r.month_key: flt(r.net_total) for r in rows}

    months = []
    cursor = get_first_day(from_date)
    last_month = get_first_day(to_date)
    while cursor <= last_month:
        months.append(cursor)
        cursor = add_months(cursor, 1)

    items = [
        {
            "month": m.strftime("%b"),
            "val": totals_by_month.get(m.strftime("%Y-%m"), 0),
            "revenue": totals_by_month.get(m.strftime("%Y-%m"), 0),
            "revenue_fmt": fmt_inr(totals_by_month.get(m.strftime("%Y-%m"), 0)),
        }
        for m in months
    ]

    return items

# ============================================================
# CARD 2: SALES ORDER STATS (DYNAMIC)
# ============================================================

SALES_ORDER_PENDING_STATUSES = ("To Deliver and Bill", "To Bill", "To Deliver")

@frappe.whitelist()
def get_sales_order_stats(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Sales Order stats for the selected date range:
      - count      : all SUBMITTED Sales Orders (docstatus = 1)
      - completed  : submitted Sales Orders with status = "Completed"
      - pending    : submitted Sales Orders still open - status in
                      SALES_ORDER_PENDING_STATUSES (To Deliver and Bill /
                      To Bill / To Deliver), same definition used by the
                      Delayed Orders card
      - cancelled  : cancelled Sales Orders (docstatus = 2)
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = "transaction_date BETWEEN %(from_date)s AND %(to_date)s"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT status, docstatus, COUNT(*) as cnt
        FROM `tabSales Order`
        WHERE {conditions}
        GROUP BY status, docstatus
        """,
        params,
        as_dict=True,
    )

    count = 0        # submitted orders
    completed = 0    # submitted + status Completed
    pending = 0      # submitted + status still open (see SALES_ORDER_PENDING_STATUSES)
    cancelled = 0    # cancelled

    for r in rows:
        if r.docstatus == 1:
            count += r.cnt
            if r.status == "Completed":
                completed += r.cnt
            elif r.status in SALES_ORDER_PENDING_STATUSES:
                pending += r.cnt
        elif r.docstatus == 2:
            cancelled += r.cnt

    # Get total amount (submitted only) for profit calculation
    amount = frappe.db.sql(
        f"""
        SELECT SUM(base_net_total)
        FROM `tabSales Order`
        WHERE {conditions} AND docstatus = 1
        """,
        params,
    )[0][0] or 0

    return {
        "count": count,
        "completed": completed,
        "pending": pending,
        "cancelled": cancelled,
        "amount": amount,
        "amount_fmt": fmt_inr(amount),
        "profit_fmt": fmt_inr(amount * 0.2),  # 20% estimated profit
        "from_date": str(from_date),
        "to_date": str(to_date),
    }

# ============================================================
# CARD 3: QUOTATION STATS (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_quotation_stats(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Quotation stats for the selected date range (submitted quotations only):
      - total_count   : number of submitted quotations
      - total_value   : SUM(base_net_total) of all submitted quotations
      - lost_value    : SUM(base_net_total) of quotations with status = "Lost"
      - expired_value : SUM(base_net_total) of quotations with status = "Expired"
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = "transaction_date BETWEEN %(from_date)s AND %(to_date)s AND docstatus = 1"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT status, COUNT(*) as cnt, SUM(base_net_total) as net_total
        FROM `tabQuotation`
        WHERE {conditions}
        GROUP BY status
        """,
        params,
        as_dict=True,
    )

    total_count = 0
    total_value = 0
    lost_value = 0
    lost_count = 0
    expired_value = 0
    expired_count = 0

    for r in rows:
        val = flt(r.net_total)
        total_count += r.cnt
        total_value += val
        if r.status == "Lost":
            lost_value += val
            lost_count += r.cnt
        elif r.status == "Expired":
            expired_value += val
            expired_count += r.cnt

    return {
        "total_count": total_count,
        "total_value": total_value,
        "total_value_fmt": fmt_inr(total_value),
        "lost_value_fmt": fmt_inr(lost_value),
        "lost_count": lost_count,
        "expired_value_fmt": fmt_inr(expired_value),
        "expired_count": expired_count,
        "from_date": str(from_date),
        "to_date": str(to_date),
    }

# ============================================================
# CARD 4: CURRENCY AVERAGE RATES (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_currency_averages(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Average exchange rate per currency from the Currency Exchange DocType,
    for the selected date range.

    For every `from_currency`, averages `exchange_rate` over all rows whose
    `date` falls in the range and whose `to_currency` is the base currency
    (company default, else the global default, else INR).
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    base_currency = None
    if company:
        base_currency = frappe.get_cached_value("Company", company, "default_currency")
    if not base_currency:
        base_currency = frappe.defaults.get_global_default("currency") or "INR"

    rows = frappe.db.sql(
        """
        SELECT from_currency AS currency, AVG(exchange_rate) AS avg_rate
        FROM `tabCurrency Exchange`
        WHERE `date` BETWEEN %(from_date)s AND %(to_date)s
          AND to_currency = %(base_currency)s
          AND from_currency != %(base_currency)s
        GROUP BY from_currency
        ORDER BY from_currency
        """,
        {"from_date": from_date, "to_date": to_date, "base_currency": base_currency},
        as_dict=True,
    )

    symbol = frappe.db.get_value("Currency", base_currency, "symbol") or (base_currency + " ")

    items = []
    for r in rows:
        rate = flt(r.avg_rate)
        items.append({
            "currency": r.currency,
            "avg_rate": rate,
            "rate_fmt": "{0} {1:,.2f}".format(symbol, rate),
        })

    return {
        "base_currency": base_currency,
        "items": items,
        "from_date": str(from_date),
        "to_date": str(to_date),
    }

# ============================================================
# CARD 5: CONVERSION RATIO (DYNAMIC)
# ============================================================

def _conversion_metrics(from_date, to_date, company=None):
    """
    For submitted quotations in a range, return
    (quotation_count, converted_count, percentage).
    A quotation is "converted" when its status is "Ordered"
    (i.e. it produced a Sales Order).
    """
    conditions = "transaction_date BETWEEN %(from_date)s AND %(to_date)s AND docstatus = 1"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND company = %(company)s"
        params["company"] = company

    row = frappe.db.sql(
        f"""
        SELECT
            COUNT(*) AS quotation_count,
            SUM(CASE WHEN status = 'Ordered' THEN 1 ELSE 0 END) AS order_count
        FROM `tabQuotation`
        WHERE {conditions}
        """,
        params,
        as_dict=True,
    )[0]

    quotation_count = row.quotation_count or 0
    order_count = row.order_count or 0
    percentage = (order_count / quotation_count * 100) if quotation_count else 0
    return quotation_count, order_count, percentage


@frappe.whitelist()
def get_conversion_ratio(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Quotation -> Sales Order conversion ratio for the selected period,
    with a period-over-period trend:
      yearly  -> this year vs previous year
      monthly -> this month vs previous month
      weekly  -> this week vs previous week
      custom  -> the selected window vs the preceding window of equal length
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)
    prev_from, prev_to = get_previous_date_range(from_date, to_date)

    q_count, o_count, pct = _conversion_metrics(from_date, to_date, company)
    _, _, prev_pct = _conversion_metrics(prev_from, prev_to, company)

    diff = pct - prev_pct
    trend_up = diff >= 0
    trend = "{0}{1:.1f}%".format("+" if trend_up else "-", abs(diff))

    return {
        "percentage": round(pct, 1),
        "trend": trend,
        "trend_up": trend_up,
        "quotation_count": q_count,
        "order_count": o_count,
        "prev_percentage": round(prev_pct, 1),
        "from_date": str(from_date),
        "to_date": str(to_date),
        "prev_from_date": str(prev_from),
        "prev_to_date": str(prev_to),
    }

# ============================================================
# CARD 6: PENDING MATERIAL REQUEST FOR SALES ORDER (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_pending_mr_sales_orders(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Submitted Sales Orders for which NO Material Request has ever been
    created (not even partially) - i.e. no `tabMaterial Request Item` row
    references the Sales Order at all.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = "so.docstatus = 1 AND so.transaction_date BETWEEN %(from_date)s AND %(to_date)s"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND so.company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT
            so.name,
            so.customer_name,
            so.transaction_date,
            so.status,
            so.base_grand_total
        FROM `tabSales Order` so
        LEFT JOIN `tabMaterial Request Item` mri ON mri.sales_order = so.name
        LEFT JOIN `tabMaterial Request` mr ON mr.name = mri.parent
        WHERE {conditions}
            AND mr.name IS NULL
        GROUP BY so.name
        ORDER BY so.transaction_date DESC
        """,
        params,
        as_dict=True,
    )

    items = [
        {
            "name": r.name,
            "customer": r.customer_name,
            "transaction_date": frappe.utils.formatdate(r.transaction_date),
            "status": r.status,
            "amount_fmt": fmt_inr(r.base_grand_total),
        }
        for r in rows
    ]

    return {
        "count": len(items),
        "items": items,
        "from_date": str(from_date),
        "to_date": str(to_date),
    }

# ============================================================
# CARD 7: PENDING PO FOR MATERIAL REQUEST (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_pending_po_material_requests(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Submitted Purchase Material Requests that are not yet fully ordered -
    i.e. status is "Pending" (no Purchase Order ever created against it)
    or "Partially Ordered" (some qty ordered, some still pending).
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = (
        "mr.docstatus = 1"
        " AND mr.material_request_type = 'Purchase'"
        " AND mr.transaction_date BETWEEN %(from_date)s AND %(to_date)s"
        " AND mr.status IN ('Pending', 'Partially Ordered')"
    )
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND mr.company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT
            mr.name,
            mr.company,
            mr.transaction_date,
            mr.status,
            mr.per_ordered,
            SUM(mri.amount) AS total_amount
        FROM `tabMaterial Request` mr
        LEFT JOIN `tabMaterial Request Item` mri ON mri.parent = mr.name
        WHERE {conditions}
        GROUP BY mr.name
        ORDER BY mr.transaction_date DESC
        """,
        params,
        as_dict=True,
    )

    items = [
        {
            "name": r.name,
            "company": r.company,
            "transaction_date": frappe.utils.formatdate(r.transaction_date),
            "status": r.status,
            "per_ordered": round(flt(r.per_ordered), 1),
            "amount_fmt": fmt_inr(r.total_amount),
        }
        for r in rows
    ]

    return {
        "count": len(items),
        "items": items,
        "from_date": str(from_date),
        "to_date": str(to_date),
    }

# ============================================================
# CARD 8: RECEIPT PENDING FOR PURCHASE ORDER (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_receipt_pending_purchase_orders(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Submitted Purchase Orders for which NO submitted Purchase Receipt has
    been created yet - i.e. no `tabPurchase Receipt Item` row (belonging
    to a submitted Purchase Receipt) references the Purchase Order at all.
    Excludes POs whose status is Closed, Completed, or Draft.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = (
        "po.docstatus = 1"
        " AND po.status NOT IN ('Closed', 'Completed', 'Draft')"
        " AND po.transaction_date BETWEEN %(from_date)s AND %(to_date)s"
    )
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND po.company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT
            po.name,
            po.supplier_name,
            po.transaction_date,
            po.status,
            po.base_grand_total
        FROM `tabPurchase Order` po
        WHERE {conditions}
            AND NOT EXISTS (
                SELECT 1
                FROM `tabPurchase Receipt Item` pri
                INNER JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
                WHERE pri.purchase_order = po.name
                    AND pr.docstatus = 1
            )
        ORDER BY po.transaction_date DESC
        """,
        params,
        as_dict=True,
    )

    items = [
        {
            "name": r.name,
            "supplier": r.supplier_name,
            "transaction_date": frappe.utils.formatdate(r.transaction_date),
            "status": r.status,
            "amount_fmt": fmt_inr(r.base_grand_total),
        }
        for r in rows
    ]

    return {
        "count": len(items),
        "items": items,
        "from_date": str(from_date),
        "to_date": str(to_date),
    }

# ============================================================
# CARD 9: PENDING DELIVERY FOR SALES ORDER (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_pending_delivery_sales_orders(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Submitted Sales Order Items whose delivered qty (from submitted
    Delivery Notes) is less than the ordered qty - i.e. still pending
    delivery, combined per (Sales Order, Item) so that multiple lines
    of the same item on the same order are shown as a single row.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = "so.docstatus = 1 AND so.transaction_date BETWEEN %(from_date)s AND %(to_date)s"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND so.company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT
            x.sales_order,
            x.transaction_date,
            x.customer,
            x.item_code,
            SUM(x.ordered_qty) AS ordered_qty,
            SUM(x.delivered_qty) AS delivered_qty,
            SUM(x.ordered_qty) - SUM(x.delivered_qty) AS pending_qty
        FROM (
            SELECT
                so.name AS sales_order,
                so.transaction_date,
                so.customer,
                soi.item_code,
                soi.qty AS ordered_qty,
                COALESCE(SUM(
                    CASE WHEN dn.docstatus = 1 THEN dni.qty ELSE 0 END
                ), 0) AS delivered_qty
            FROM `tabSales Order` so
            INNER JOIN `tabSales Order Item` soi ON soi.parent = so.name
            LEFT JOIN `tabDelivery Note Item` dni
                ON dni.against_sales_order = so.name
                AND dni.so_detail = soi.name
            LEFT JOIN `tabDelivery Note` dn ON dn.name = dni.parent
            WHERE {conditions}
            GROUP BY so.name, so.transaction_date, so.customer, soi.name, soi.item_code, soi.qty
        ) x
        GROUP BY x.sales_order, x.transaction_date, x.customer, x.item_code
        HAVING pending_qty > 0
        ORDER BY x.transaction_date DESC
        """,
        params,
        as_dict=True,
    )

    items = [
        {
            "name": r.sales_order,
            "customer": r.customer,
            "transaction_date": frappe.utils.formatdate(r.transaction_date),
            "item_code": r.item_code,
            "ordered_qty": flt(r.ordered_qty),
            "delivered_qty": flt(r.delivered_qty),
            "pending_qty": flt(r.pending_qty),
        }
        for r in rows
    ]

    return {
        "count": len({r.sales_order for r in rows}),
        "items": items,
        "from_date": str(from_date),
        "to_date": str(to_date),
    }

# ============================================================
# CARD 10: TREASURY BALANCES (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_treasury_balances(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Balances as of `to_date`, computed from GL Entry, restricted to accounts
    registered as the company's own Bank Accounts (`tabBank Account` with
    `is_company_account = 1`) - this excludes customer/supplier bank
    accounts and any stray Bank/Cash-type ledger accounts that aren't a
    real company bank account.

    Two figures are derived, deliberately from different GL Entry columns:
      - base_total    : SUM(debit) - SUM(credit) -> already expressed in the
                         company's base currency, so it can be summed
                         straight across every account.
      - per currency  : SUM(debit_in_account_currency) - SUM(credit_in_account_currency)
                         grouped by account_currency -> the *native* balance
                         held in that currency (e.g. actual USD in a USD
                         account), not its base-currency equivalent.
    Mixing these two (summing `debit`/`credit` but labelling the result by
    `account_currency`) understates/overstates foreign-currency balances,
    so they're kept separate here.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = (
        "gle.is_cancelled = 0"
        " AND ba.is_company_account = 1"
        " AND gle.posting_date <= %(to_date)s"
    )
    params = {"to_date": to_date}
    if company:
        conditions += " AND gle.company = %(company)s"
        params["company"] = company

    base_currency = None
    if company:
        base_currency = frappe.get_cached_value("Company", company, "default_currency")
    if not base_currency:
        base_currency = frappe.defaults.get_global_default("currency") or "INR"

    rows = frappe.db.sql(
        f"""
        SELECT
            gle.account,
            acc.account_currency AS currency,
            SUM(gle.debit) - SUM(gle.credit) AS base_balance,
            SUM(gle.debit_in_account_currency) - SUM(gle.credit_in_account_currency) AS native_balance
        FROM `tabGL Entry` gle
        INNER JOIN `tabAccount` acc ON acc.name = gle.account
        INNER JOIN `tabBank Account` ba ON ba.account = acc.name
        WHERE {conditions}
        GROUP BY gle.account, acc.account_currency
        ORDER BY acc.account_currency, gle.account
        """,
        params,
        as_dict=True,
    )

    symbol_cache = {}
    def currency_symbol(cur):
        if cur not in symbol_cache:
            symbol_cache[cur] = frappe.db.get_value("Currency", cur, "symbol") or (cur + " ")
        return symbol_cache[cur]

    base_fmt = fmt_inr_full if base_currency == "INR" else (lambda v: fmt_money_full(v, currency_symbol(base_currency)))

    base_total = sum(flt(r.base_balance) for r in rows)

    currency_totals = {}
    for r in rows:
        cur = r.currency or base_currency
        currency_totals[cur] = currency_totals.get(cur, 0) + flt(r.native_balance)

    currencies = [
        {
            "currency": cur,
            "balance": bal,
            "balance_fmt": fmt_money_full(bal, currency_symbol(cur)),
        }
        for cur, bal in sorted(currency_totals.items())
    ]

    accounts = [
        {
            "account": r.account,
            "currency": r.currency,
            "balance_fmt": fmt_money(flt(r.native_balance), currency_symbol(r.currency)),
            "base_balance_fmt": base_fmt(flt(r.base_balance)),
        }
        for r in rows
    ]

    return {
        "base_currency": base_currency,
        "base_total": base_total,
        "base_total_fmt": base_fmt(base_total),
        "currencies": currencies,
        "accounts": accounts,
        "as_of_date": str(to_date),
    }

# ============================================================
# CARD 11: RECEIVABLES (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_receivables_balances(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Outstanding customer receivables as of `to_date`, sourced from the
    standard "Accounts Receivable" report (Payment-Ledger-Entry based, same
    report opened by the card's "Click to view Accounts Receivable" link)
    so these numbers always match what that report shows:
      - base_total   : sum of each row's "Outstanding Amount" with
                        "In Party Currency" OFF - i.e. company/base
                        currency, same as the report's own grand total.
      - per currency : sum of "Outstanding Amount" with "In Party Currency"
                        ON, grouped by each row's own currency - the actual
                        balance owed in that currency (e.g. real USD owed
                        by a USD customer), not its base-currency
                        equivalent.
    """
    from erpnext.accounts.report.accounts_receivable.accounts_receivable import (
        execute as run_accounts_receivable,
    )

    from_date, to_date = get_date_range(period_preset, from_date, to_date)
    report_date = getdate(to_date)

    # The report itself requires a single company (it defaults to the
    # Global Default Company if none is passed) - to honour "All Companies"
    # the same way every other card on this dashboard does, run it once per
    # company and sum the results when no company filter is selected.
    companies = [company] if company else frappe.get_all("Company", pluck="name")

    base_currency = None
    if company:
        base_currency = frappe.get_cached_value("Company", company, "default_currency")
    if not base_currency:
        base_currency = frappe.defaults.get_global_default("currency") or "INR"

    base_total = 0.0
    currency_totals = {}

    for cmp in companies:
        base_filters = frappe._dict({
            "company": cmp,
            "report_date": report_date,
            "in_party_currency": 0,
        })
        _, base_rows = run_accounts_receivable(base_filters)[:2]
        base_total += sum(flt(r.outstanding) for r in base_rows)

        party_filters = frappe._dict({
            "company": cmp,
            "report_date": report_date,
            "in_party_currency": 1,
        })
        _, party_rows = run_accounts_receivable(party_filters)[:2]
        for r in party_rows:
            cur = r.currency or base_currency
            currency_totals[cur] = currency_totals.get(cur, 0) + flt(r.outstanding)

    symbol_cache = {}
    def currency_symbol(cur):
        if cur not in symbol_cache:
            symbol_cache[cur] = frappe.db.get_value("Currency", cur, "symbol") or (cur + " ")
        return symbol_cache[cur]

    base_fmt = fmt_inr_full if base_currency == "INR" else (lambda v: fmt_money_full(v, currency_symbol(base_currency)))

    currencies = [
        {
            "currency": cur,
            "balance": bal,
            "balance_fmt": fmt_money_full(bal, currency_symbol(cur)),
        }
        for cur, bal in sorted(currency_totals.items())
    ]

    return {
        "base_currency": base_currency,
        "base_total": base_total,
        "base_total_fmt": base_fmt(base_total),
        "currencies": currencies,
        "as_of_date": str(to_date),
    }

# ============================================================
# CARD 12: TAX CLAIMS (DYNAMIC)
# ============================================================

TAX_CLAIM_TYPES = [
    {"key": "drawback", "label": "Drawback", "pattern": "%Duty Drawback Receivable%"},
    # Matches both the correct and the misspelled ("Recievable") account name
    # actually used on some sites - keeping just the "IGST Refund" root avoids
    # depending on that spelling at all.
    {"key": "igst", "label": "IGST Refund", "pattern": "%IGST Refund%"},
    {"key": "rodtep", "label": "RODTEP", "pattern": "%RODTEP License Receivable%"},
]

@frappe.whitelist()
def get_tax_claims(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Claimed vs received amounts within [from_date, to_date] for each
    tax-refund receivable type (Duty Drawback, IGST Refund, RODTEP),
    matched by account name rather than a hardcoded account list so it
    works across companies. For each matching account:
      - claimed (debit)  : total amount claimed in the selected range
      - received (credit): total amount actually received in the range
      - balance          : claimed - received (signed - can go negative on
                            an overpayment/refund reversal)
      - pending          : balance, floored at 0 (used for the progress bar)

    Also returns the exact matched account name(s) and the date range, so
    the card can link straight through to the General Ledger report with
    the same accounts/company/date filters applied (same idea as the
    Receivables and Aging Payables cards linking to their own reports).
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    items = []
    all_accounts = []
    for claim in TAX_CLAIM_TYPES:
        account_conditions = "name LIKE %(pattern)s"
        account_params = {"pattern": claim["pattern"]}
        if company:
            account_conditions += " AND company = %(company)s"
            account_params["company"] = company

        accounts = frappe.db.sql_list(
            f"SELECT name FROM `tabAccount` WHERE {account_conditions} ORDER BY name",
            account_params,
        )
        all_accounts.extend(accounts)

        if accounts:
            conditions = (
                "gle.is_cancelled = 0"
                " AND gle.account IN %(accounts)s"
                " AND gle.posting_date BETWEEN %(from_date)s AND %(to_date)s"
            )
            params = {"accounts": accounts, "from_date": from_date, "to_date": to_date}
            if company:
                conditions += " AND gle.company = %(company)s"
                params["company"] = company

            row = frappe.db.sql(
                f"""
                SELECT
                    COALESCE(SUM(gle.debit), 0) AS claimed,
                    COALESCE(SUM(gle.credit), 0) AS received
                FROM `tabGL Entry` gle
                WHERE {conditions}
                """,
                params,
                as_dict=True,
            )[0]
        else:
            row = frappe._dict(claimed=0, received=0)

        claimed = flt(row.claimed)
        received = flt(row.received)
        balance = claimed - received
        pending = max(balance, 0)
        percentage = min(round((received / claimed * 100), 1), 100) if claimed else 0

        items.append({
            "key": claim["key"],
            "label": claim["label"],
            "accounts": accounts,
            "claimed": claimed,
            "received": received,
            "balance": balance,
            "pending": pending,
            "percentage": percentage,
            "total_fmt": fmt_inr(claimed),
            "received_fmt": fmt_inr(received),
            "balance_fmt": fmt_inr(balance),
            "pending_fmt": fmt_inr(pending),
        })

    return {
        "items": items,
        "accounts": all_accounts,
        "company": company,
        "from_date": str(from_date),
        "to_date": str(to_date),
        "as_of_date": str(to_date),
    }

# ============================================================
# CARD 13: AGING PAYABLES (DYNAMIC)
# ============================================================

# Bucket boundaries (days overdue) fed into the standard Accounts Payable
# Summary report's "range" filter. With "1,7,30,45" the report itself
# buckets outstanding amounts into 0-1, 2-7, 8-30, 31-45, 46-Above (plus
# <0 for not-yet-due) - these are surfaced here as-is so the card totals
# reconcile exactly with the report's own "Total Amount Due" grand total.
AGING_PAYABLES_RANGE = "7,15,30,45"
AGING_PAYABLES_BUCKETS = [
    # {"key": "not_due", "label": "< 0", "field": "range0"},
    {"key": "day", "label": "1-7", "field": "range1"},
    {"key": "week", "label": "8-15", "field": "range2"},
    {"key": "month", "label": "16-30", "field": "range3"},
    {"key": "old30", "label": "31-45", "field": "range4"},
    {"key": "old45", "label": "46-Above", "field": "range5"},
]

@frappe.whitelist()
def get_aging_payables(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Outstanding-payables ageing, sourced from the standard "Accounts
    Payable Summary" report (same FIFO-against-Payment-Ledger-Entry
    ageing math as that report) so the numbers here always match what
    that report shows, using the 1/7/30/45-day bucket boundaries above
    instead of the report's default 30/60/90/120.

    Always a live snapshot "as of today" - period_preset/from_date/to_date
    are accepted only for a consistent call signature with the other cards
    and aren't used for the ageing cutoff. Ageing is `report_date - due_date`,
    so using the selected period's to_date (e.g. a future fiscal year-end
    for the "yearly" preset) would inflate every invoice's age and dump
    everything into the oldest bucket.
    """
    from erpnext.accounts.report.accounts_payable_summary.accounts_payable_summary import (
        execute as run_accounts_payable_summary,
    )

    report_date = getdate(today())

    # The report itself requires a single company (it defaults to the
    # Global Default Company if none is passed) - to honour "All Companies"
    # the same way every other card on this dashboard does, run it once per
    # company and sum the buckets when no company filter is selected.
    companies = [company] if company else frappe.get_all("Company", pluck="name")

    totals = {b["key"]: 0.0 for b in AGING_PAYABLES_BUCKETS}
    for cmp in companies:
        filters = frappe._dict({
            "report_date": report_date,
            "range": AGING_PAYABLES_RANGE,
            "company": cmp,
            "ageing_based_on": "Due Date",
        })
        _, rows = run_accounts_payable_summary(filters)
        for r in rows:
            r = frappe._dict(r)
            for b in AGING_PAYABLES_BUCKETS:
                totals[b["key"]] += flt(r.get(b["field"]))

    grand_total = sum(totals.values())
    max_val = max(list(totals.values()) + [1])

    items = [
        {
            "key": b["key"],
            "label": b["label"],
            "value_fmt": fmt_inr(totals[b["key"]]),
            "chart": round(totals[b["key"]] / max_val * 100, 1),
        }
        for b in AGING_PAYABLES_BUCKETS
    ]

    return {
        "items": items,
        "total_fmt": fmt_inr(grand_total),
        "as_of_date": str(report_date),
    }

# ============================================================
# LEADERBOARD: TOP COMPANIES BY PURCHASE (DYNAMIC)
# ============================================================
@frappe.whitelist()
def get_top_purchase_companies(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Suppliers we've bought the most from - by Net Total (base_net_total)
    across submitted Purchase Invoices in the selected period.
    Only includes suppliers belonging to the 'Product Supplier' supplier group.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = """
        pi.docstatus = 1
        AND pi.posting_date BETWEEN %(from_date)s AND %(to_date)s
        AND s.supplier_group = 'Product Supplier'
    """

    params = {
        "from_date": from_date,
        "to_date": to_date,
    }

    if company:
        conditions += " AND pi.company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT
            pi.supplier,
            pi.supplier_name,
            SUM(pi.base_net_total) AS net_total
        FROM `tabPurchase Invoice` pi
        INNER JOIN `tabSupplier` s
            ON s.name = pi.supplier
        WHERE {conditions}
        GROUP BY pi.supplier, pi.supplier_name
        ORDER BY net_total DESC
        LIMIT 10
        """,
        params,
        as_dict=True,
    )

    return [
        {
            "name": r.supplier_name or r.supplier,
            "amount": flt(r.net_total),
            "val": fmt_inr(flt(r.net_total)),
        }
        for r in rows
    ]

# ============================================================
# LEADERBOARD: TOP CUSTOMERS BY SALES (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_top_customers(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Customers we've sold the most to - by Net Total (base_net_total) across
    submitted Sales Invoices in the selected period. Powers the "Top
    Customers" leaderboard. Country badge is read off each customer's
    (primary, if set) address.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = "docstatus = 1 AND transaction_date BETWEEN %(from_date)s AND %(to_date)s"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT
            customer,
            customer_name,
            SUM(base_net_total) AS net_total
        FROM `tabSales Order`
        WHERE {conditions}
        GROUP BY customer
        ORDER BY net_total DESC
        LIMIT 10
        """,
        params,
        as_dict=True,
    )
    if not rows:
        return []

    customers = [r.customer for r in rows]
    address_rows = frappe.db.sql(
        """
        SELECT dl.link_name AS customer, addr.country AS country, addr.is_primary_address AS is_primary
        FROM `tabDynamic Link` dl
        INNER JOIN `tabAddress` addr ON addr.name = dl.parent
        WHERE dl.link_doctype = 'Customer'
            AND dl.parenttype = 'Address'
            AND dl.link_name IN %(customers)s
            AND addr.country IS NOT NULL AND addr.country != ''
        """,
        {"customers": customers},
        as_dict=True,
    )
    country_by_customer = {}
    for r in address_rows:
        if r.customer not in country_by_customer or r.is_primary:
            country_by_customer[r.customer] = r.country

    code_cache = {}
    def country_code(country):
        if not country:
            return ""
        if country not in code_cache:
            code_cache[country] = (frappe.db.get_value("Country", country, "country_name") or "").upper()
        return code_cache[country]

    return [
        {
            "name": r.customer_name or r.customer,
            "country": country_code(country_by_customer.get(r.customer)),
            "amount": flt(r.net_total),
            "val": fmt_inr(flt(r.net_total)),
        }
        for r in rows
    ]

# ============================================================
# LEADERBOARD: TOP DELAYED ORDERS (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_top_delayed_orders(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Submitted Sales Orders whose delivery_date has passed and are still
    open (not Completed/Closed/Cancelled), ranked by how many days overdue.
    A live snapshot "as of today" - like get_aging_payables, this isn't
    scoped to period_preset/from_date/to_date since "most delayed right
    now" doesn't mean anything for a past period window.
    """
    conditions = (
        "so.docstatus = 1"
        " AND so.status  IN ('To Deliver and Bill', 'To Bill', 'To Deliver')"
    )
    
    
    params = {}
    if company:
        conditions += " AND so.company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT
            so.name AS sales_order,
            so.customer,
            so.customer_name,
            so.delivery_date,
            DATEDIFF(CURDATE(), so.delivery_date) AS delayed_days
        FROM `tabSales Order` so
        WHERE {conditions}
        ORDER BY delayed_days DESC
        LIMIT 10
        """,
        params,
        as_dict=True,
    )

    return [
        {
            "id": r.sales_order,
            "customer": r.customer_name or r.customer,
            "delay": f"{cint(r.delayed_days)} Days",
        }
        for r in rows
    ]

import json

def _parse_item_groups(item_groups):
    """Normalize item_groups which may arrive as a real list (server-side
    call), a JSON-encoded string (frappe.call from JS), or a single string."""
    if not item_groups:
        return None
    if isinstance(item_groups, str):
        try:
            item_groups = json.loads(item_groups)
        except (ValueError, TypeError):
            item_groups = [item_groups]
    if not isinstance(item_groups, (list, tuple, set)):
        item_groups = [item_groups]
    item_groups = [g for g in item_groups if g]
    return item_groups or None
# ============================================================
# LEADERBOARD: TOP STOCK ITEMS (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_top_stock_items(company=None, item_groups=None, sort_by="qty"):
    """
    Current on-hand stock, summed across warehouses per item from Bin
    (actual_qty / stock_value) - a live balance, not scoped to the period
    filter. Powers the "Top Stock Items" leaderboard, toggled between
    Qty-wise and Amount-wise ranking.
    """
    order_field = "stock_value" if sort_by == "amount" else "qty"

    conditions = "bin.actual_qty > 0"
    params = {}
    if company:
        conditions += " AND bin.company = %(company)s"
        params["company"] = company

    item_groups = _parse_item_groups(item_groups)
    if item_groups:
        conditions += " AND item.item_group IN %(item_groups)s"
        params["item_groups"] = tuple(item_groups)

    rows = frappe.db.sql(
        f"""
        SELECT
            bin.item_code,
            item.item_name,
            item.stock_uom,
            SUM(bin.actual_qty) AS qty,
            SUM(bin.stock_value) AS stock_value
        FROM `tabBin` bin
        INNER JOIN `tabItem` item ON item.name = bin.item_code
        WHERE {conditions}
        GROUP BY bin.item_code
        ORDER BY {order_field} DESC
        LIMIT 10
        """,
        params,
        as_dict=True,
    )

    return [
        {
            "item_code": r.item_code,
            "name": r.item_name or r.item_code,
            "qty": "{:,.0f} {}".format(flt(r.qty), r.stock_uom or ""),
            "val": fmt_inr(flt(r.stock_value)),
        }
        for r in rows
    ]

# ============================================================
# LEADERBOARD: TOP SELLING ITEMS (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_top_selling_items(period_preset="yearly", company=None, item_groups=None, from_date=None, to_date=None, sort_by="qty"):
    """
    Items sold the most in the selected period, from submitted Sales
    Invoice Items (qty / base_net_amount). Powers the "Top Selling"
    leaderboard, toggled between Qty-wise and Amount-wise ranking.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)
    order_field = "amount" if sort_by == "amount" else "qty"

    conditions = (
        "si.docstatus = 1"
        " AND si.posting_date BETWEEN %(from_date)s AND %(to_date)s"
    )
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND si.company = %(company)s"
        params["company"] = company

    item_groups = _parse_item_groups(item_groups)
    if item_groups:
        conditions += " AND item.item_group IN %(item_groups)s"
        params["item_groups"] = tuple(item_groups)

    rows = frappe.db.sql(
        f"""
        SELECT
            sii.item_code,
            sii.item_name,
            sii.stock_uom,
            SUM(sii.stock_qty) AS qty,
            SUM(sii.base_net_amount) AS amount
        FROM `tabSales Invoice Item` sii
        INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
        INNER JOIN `tabItem` item ON item.name = sii.item_code
        WHERE {conditions}
        GROUP BY sii.item_code
        ORDER BY {order_field} DESC
        LIMIT 10
        """,
        params,
        as_dict=True,
    )

    return [
        {
            "item_code": r.item_code,
            "name": r.item_name or r.item_code,
            "qty": "{:,.0f} {}".format(flt(r.qty), r.stock_uom or ""),
            "val": fmt_inr(flt(r.amount)),
        }
        for r in rows
    ]

# ============================================================
# LEADERBOARD: TOP PURCHASE ITEMS (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_top_purchase_items(period_preset="yearly", company=None, item_groups=None, from_date=None, to_date=None, sort_by="qty"):
    """
    Items bought the most in the selected period, from submitted Purchase
    Invoice Items (qty / base_net_amount). Powers the "Top Purchase"
    leaderboard, toggled between Qty-wise and Amount-wise ranking.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)
    order_field = "amount" if sort_by == "amount" else "qty"

    conditions = (
        "pi.docstatus = 1"
        " AND pi.posting_date BETWEEN %(from_date)s AND %(to_date)s"
    )
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND pi.company = %(company)s"
        params["company"] = company

    item_groups = _parse_item_groups(item_groups)
    if item_groups:
        conditions += " AND item.item_group IN %(item_groups)s"
        params["item_groups"] = tuple(item_groups)
    rows = frappe.db.sql(
    f"""
    SELECT
        item_code,
        item_name,
        stock_uom,
        SUM(qty) AS qty,
        SUM(amount) AS amount
    FROM (

        /* Purchase Receipt */
        SELECT
            pri.item_code,
            pri.item_name,
            pri.stock_uom,
            pri.stock_qty AS qty,
            pri.base_net_amount AS amount
        FROM `tabPurchase Receipt Item` pri
        INNER JOIN `tabPurchase Receipt` pr
            ON pr.name = pri.parent
        INNER JOIN `tabItem` item
            ON item.name = pri.item_code
        WHERE
            pr.docstatus = 1
            AND pr.posting_date BETWEEN %(from_date)s AND %(to_date)s
            {f"AND pr.company = %(company)s" if company else ""}
            {f"AND item.item_group IN %(item_groups)s" if item_groups else ""}

        UNION ALL

        /* Subcontracting Receipt */
        SELECT
            sri.item_code,
            sri.item_name,
            sri.stock_uom,
            sri.qty AS qty,
            sri.amount AS amount
        FROM `tabSubcontracting Receipt Item` sri
        INNER JOIN `tabSubcontracting Receipt` sr
            ON sr.name = sri.parent
        INNER JOIN `tabItem` item
            ON item.name = sri.item_code
        WHERE
            sr.docstatus = 1
            AND sr.posting_date BETWEEN %(from_date)s AND %(to_date)s
            {f"AND sr.company = %(company)s" if company else ""}
            {f"AND item.item_group IN %(item_groups)s" if item_groups else ""}

        UNION ALL

        /* Stock Entry */
        SELECT
            sed.item_code,
            sed.item_name,
            sed.stock_uom,
            sed.qty AS qty,
            (sed.basic_rate * sed.qty) AS amount
        FROM `tabStock Entry Detail` sed
        INNER JOIN `tabStock Entry` se
            ON se.name = sed.parent
        INNER JOIN `tabItem` item
            ON item.name = sed.item_code
        WHERE
            se.docstatus = 1
            AND se.posting_date BETWEEN %(from_date)s AND %(to_date)s
            {f"AND se.company = %(company)s" if company else ""}
            {f"AND item.item_group IN %(item_groups)s" if item_groups else ""}
            AND se.stock_entry_type = 'Material Receipt'

    ) t

    GROUP BY item_code, item_name, stock_uom
    ORDER BY {order_field} DESC
    LIMIT 10
    """,
    params,
    as_dict=True,
)

    return [
        {
            "item_code": r.item_code,
            "name": r.item_name or r.item_code,
            "qty": "{:,.0f} {}".format(flt(r.qty), r.stock_uom or ""),
            "val": fmt_inr(flt(r.amount)),
        }
        for r in rows
    ]
    
    
# ============================================================
# HELPER: OLD CUSTOMER SET
# ============================================================

def _get_old_customer_set(from_date, company=None):
    """
    Customers with at least one submitted Sales Invoice posting_date
    strictly before `from_date`. Anyone not in this set (within the
    selected period) is treated as a New customer.
    """
    conditions = "docstatus = 1 AND posting_date < %(from_date)s"
    params = {"from_date": from_date}
    if company:
        conditions += " AND company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql_list(
        f"SELECT DISTINCT customer FROM `tabSales Invoice` WHERE {conditions}",
        params,
    )
    return set(rows)

# ============================================================
# CARD 14: NEW VS OLD CUSTOMERS (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_new_vs_old_customers(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Splits submitted Sales Invoices in the selected period between New and
    Old customers (see _get_old_customer_set), by both value (base_net_total)
    and count (number of invoices), each with a % share of the period total.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)
    old_customers = _get_old_customer_set(from_date, company)

    conditions = "docstatus = 1 AND posting_date BETWEEN %(from_date)s AND %(to_date)s"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT customer, SUM(base_net_total) AS net_total, COUNT(*) AS cnt
        FROM `tabSales Invoice`
        WHERE {conditions}
        GROUP BY customer
        """,
        params,
        as_dict=True,
    )

    new_amount = old_amount = 0.0
    new_count = old_count = 0
    for r in rows:
        if r.customer in old_customers:
            old_amount += flt(r.net_total)
            old_count += cint(r.cnt)
        else:
            new_amount += flt(r.net_total)
            new_count += cint(r.cnt)

    total_amount = new_amount + old_amount
    total_count = new_count + old_count

    def pct(v, t):
        return round(v / t * 100, 1) if t else 0

    return {
        "new_customer": {
            "amount": new_amount,
            "amount_fmt": fmt_inr(new_amount),
            "amount_pct": pct(new_amount, total_amount),
            "count": new_count,
            "count_pct": pct(new_count, total_count),
        },
        "old_customer": {
            "amount": old_amount,
            "amount_fmt": fmt_inr(old_amount),
            "amount_pct": pct(old_amount, total_amount),
            "count": old_count,
            "count_pct": pct(old_count, total_count),
        },
        "total_amount_fmt": fmt_inr(total_amount),
        "total_count": total_count,
        "from_date": str(from_date),
        "to_date": str(to_date),
    }

# ============================================================
# CARD 15: OLD CUSTOMER ACTIVITY - NEW ORDERS VS INVOICES (DYNAMIC)
# ============================================================

@frappe.whitelist()
def get_old_customer_order_vs_invoice(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    For customers already established before the period (see
    _get_old_customer_set), compares:
      - so_count / so_amount : NEW Sales Orders placed by them in the period
      - si_count / si_amount : Sales Invoices billed to them in the period
    repeat_pct = si_count / so_count - roughly "how much of what old
    customers ordered has actually been invoiced" in the same window.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)
    old_customers = _get_old_customer_set(from_date, company)

    empty = {
        "so_count": 0, "so_amount_fmt": fmt_inr(0),
        "si_count": 0, "si_amount_fmt": fmt_inr(0),
        "repeat_pct": 0, "old_customer_count": 0,
        "from_date": str(from_date), "to_date": str(to_date),
    }
    if not old_customers:
        return empty

    customers = tuple(old_customers)

    so_conditions = (
        "docstatus = 1 AND transaction_date BETWEEN %(from_date)s AND %(to_date)s"
        " AND customer IN %(customers)s"
    )
    so_params = {"from_date": from_date, "to_date": to_date, "customers": customers}
    if company:
        so_conditions += " AND company = %(company)s"
        so_params["company"] = company

    so_row = frappe.db.sql(
        f"SELECT COUNT(*) AS cnt, SUM(base_net_total) AS amt FROM `tabSales Order` WHERE {so_conditions}",
        so_params,
        as_dict=True,
    )[0]

    si_conditions = (
        "docstatus = 1 AND posting_date BETWEEN %(from_date)s AND %(to_date)s"
        " AND customer IN %(customers)s"
    )
    si_params = {"from_date": from_date, "to_date": to_date, "customers": customers}
    if company:
        si_conditions += " AND company = %(company)s"
        si_params["company"] = company

    si_row = frappe.db.sql(
        f"SELECT COUNT(*) AS cnt, SUM(base_net_total) AS amt FROM `tabSales Invoice` WHERE {si_conditions}",
        si_params,
        as_dict=True,
    )[0]

    so_count = cint(so_row.cnt)
    si_count = cint(si_row.cnt)
    repeat_pct = round(si_count / so_count * 100, 1) if so_count else 0

    return {
        "so_count": so_count,
        "so_amount_fmt": fmt_inr(flt(so_row.amt)),
        "si_count": si_count,
        "si_amount_fmt": fmt_inr(flt(si_row.amt)),
        "repeat_pct": repeat_pct,
        "old_customer_count": len(old_customers),
        "from_date": str(from_date),
        "to_date": str(to_date),
    }

# ============================================================
# STATIC MOCK DATA (All other cards)
# ============================================================

def get_mock_data():
    """Return static mock data matching the HTML dashboard"""
    return {
        "quotations": {
            "total_count": 3240,
            "total_value_fmt": "₹ 452.5 Cr",
            "lost_value_fmt": "₹ 38.2 Cr",
            "expired_value_fmt": "₹ 15.6 Cr",
        },
        "conversion_ratio": {
            "percentage": 57.1,
            "trend": "+2.4%",
            "quotation_count": 3240,
            "order_count": 1850,
        },
        "currency_averages": {
            "usd": "₹ 83.45",
            "eur": "₹ 90.12",
            "gbp": "₹ 105.80",
        },
        "pipeline": {
            "pending_mr_for_so": 84,
            "pending_po": 45,
            "receipt_pending": 112,
            "pending_delivery": 38,
        },
        "treasury": {
            "inr": "₹ 85.2 Cr",
            "usd": "$ 4.5M",
            "eur": "€ 2.8M",
        },
        "receivables": {
            "inr": "₹ 32.5 Cr",
            "usd": "$ 2.1M",
            "eur": "€ 1.4M",
        },
        "tax_claims": {
            "drawback": {
                "total": "₹ 12.5 Cr",
                "received": "₹ 9.2 Cr",
                "pending": "₹ 3.3 Cr",
                "percent": 73,
            },
            "igst": {
                "total": "₹ 24.8 Cr",
                "received": "₹ 18.5 Cr",
                "pending": "₹ 6.3 Cr",
                "percent": 74,
            }
        },
        "leaderboards": {
        },
        "period_label": "YTD 2026",
    }

# ============================================================
# FULL PAGE DATA AGGREGATOR
# ============================================================

@frappe.whitelist()
def get_page_data(period_preset="yearly", company=None, item_groups=None, from_date=None, to_date=None):
    """
    Aggregator that returns all dashboard data. Leaderboards, quotation
    mock fallbacks, and a few other cards are still static mock data;
    everything else is computed live.
    """
    # Get dynamic data
    total_sales = get_total_sales(period_preset, company, from_date, to_date)
    total_sales_order = get_total_sales_order(period_preset, company, from_date, to_date)
    sales_orders = get_sales_order_stats(period_preset, company, from_date, to_date)
    quotations = get_quotation_stats(period_preset, company, from_date, to_date)
    currency_averages = get_currency_averages(period_preset, company, from_date, to_date)
    conversion_ratio = get_conversion_ratio(period_preset, company, from_date, to_date)
    pending_mr = get_pending_mr_sales_orders(period_preset, company, from_date, to_date)
    pending_po = get_pending_po_material_requests(period_preset, company, from_date, to_date)
    receipt_pending = get_receipt_pending_purchase_orders(period_preset, company, from_date, to_date)
    pending_delivery = get_pending_delivery_sales_orders(period_preset, company, from_date, to_date)
    treasury = get_treasury_balances(period_preset, company, from_date, to_date)
    receivables = get_receivables_balances(period_preset, company, from_date, to_date)
    tax_claims = get_tax_claims(period_preset, company, from_date, to_date)
    monthly_revenue = get_monthly_revenue_trend(period_preset, company, from_date, to_date)
    monthly_sales_order = get_monthly_sales_order_trend(period_preset, company, from_date, to_date)
    aging_payables = get_aging_payables(period_preset, company, from_date, to_date)
    top_purchase_companies = get_top_purchase_companies(period_preset, company, from_date, to_date)
    top_customers = get_top_customers(period_preset, company, from_date, to_date)
    top_delayed_orders = get_top_delayed_orders(period_preset, company, from_date, to_date)
    top_stock_items = get_top_stock_items(company, item_groups, "qty")
    top_selling_items = get_top_selling_items(period_preset, company, item_groups, from_date, to_date, "qty")
    top_purchase_items = get_top_purchase_items(period_preset, company, item_groups, from_date, to_date, "qty")

    # Get static mock data
    mock = get_mock_data()

    # Combine: dynamic data overrides mock for those fields
    pipeline = mock["pipeline"]
    pipeline["pending_mr_for_so"] = pending_mr["count"]
    pipeline["pending_po"] = pending_po["count"]
    pipeline["receipt_pending"] = receipt_pending["count"]
    pipeline["pending_delivery"] = pending_delivery["count"]

    leaderboards = mock["leaderboards"]
    leaderboards["topCompanies"] = top_purchase_companies
    leaderboards["topCustomers"] = top_customers
    leaderboards["delayedOrders"] = top_delayed_orders
    leaderboards["stockItems"] = top_stock_items
    leaderboards["topSelling"] = top_selling_items
    leaderboards["topPurchase"] = top_purchase_items

    return {
        "total_sales": total_sales,
        "total_sales_order": total_sales_order, 
        "sales_orders": sales_orders,
        "quotations": quotations,
        "conversion_ratio": conversion_ratio,
        "currency_averages": currency_averages,
        "pipeline": pipeline,
        "treasury": treasury,
        "receivables": receivables,
        "tax_claims": tax_claims,
        "aging_payables": aging_payables,
        "monthly_revenue": monthly_revenue,
        "monthly_sales_order": monthly_sales_order,
        "leaderboards": leaderboards,
        "period_label": mock["period_label"],
    }