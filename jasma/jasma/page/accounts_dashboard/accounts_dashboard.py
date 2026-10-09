# jasma/jasma/page/accounts_dashboard/accounts_dashboard.py

import re
import datetime
import frappe
from frappe.utils import (
    getdate, add_days, add_months, add_years, get_first_day, get_last_day, today, flt, cint, format_date,
)

# ============================================================
# DATE UTILITIES
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
        return _parse_custom_date(custom_from_date), _parse_custom_date(custom_to_date)

    if period_preset == "weekly":
        return add_days(today_date, -7), today_date

    if period_preset == "monthly":
        return get_first_day(today_date), get_last_day(today_date)

    if period_preset == "quarterly":
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
        return add_years(cur_fy_start, -1), add_days(cur_fy_start, -1)

    return get_current_fiscal_year_range(today_date)


def _parse_custom_date(date_value):
    """Safely parse custom range dates."""
    if not date_value:
        return None
    if isinstance(date_value, (datetime.date, datetime.datetime)):
        return getdate(date_value)

    value = str(date_value).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        return getdate(value)

    m = re.match(r"^(\d{1,2})-(\d{1,2})-(\d{4})$", value)
    if m:
        day, month, year = m.groups()
        return getdate(f"{year}-{int(month):02d}-{int(day):02d}")

    return getdate(value)


# ============================================================
# CURRENCY FORMATTERS
# ============================================================

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
    """Format a number as a compact K/M/B currency string with symbol."""
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
    """Format a number as a full INR currency string without abbreviations."""
    value = value or 0
    if float(value).is_integer():
        return "₹ {:,}".format(int(round(value)))
    return "₹ {:,.2f}".format(value)


def fmt_money_full(value, symbol="₹"):
    """Format a number as a full currency string without abbreviations."""
    value = value or 0
    if float(value).is_integer():
        return "{0} {1:,}".format(symbol, int(round(value)))
    return "{0} {1:,.2f}".format(symbol, value)


def get_symbol(currency):
    if not currency:
        return ""
    return frappe.db.get_value("Currency", currency, "symbol") or (currency + " ")


# ============================================================
# CARD 1: TREASURY BALANCES (Currencies Only)
# ============================================================

@frappe.whitelist()
def get_treasury_balances(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Balances as of `to_date`, computed from GL Entry for company bank accounts.
    Returns per-currency native balances.
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

    currency_totals = {}
    for r in rows:
        cur = r.currency or base_currency
        currency_totals[cur] = currency_totals.get(cur, 0) + flt(r.native_balance)

    currencies = [
        {
            "currency": cur,
            "balance": bal,
            "balance_fmt": fmt_money_full(bal, get_symbol(cur)),
        }
        for cur, bal in sorted(currency_totals.items())
    ]

    accounts = [
        {
            "account": r.account,
            "currency": r.currency,
            "balance_fmt": fmt_money(flt(r.native_balance), get_symbol(r.currency)),
            "base_balance_fmt": fmt_money_full(flt(r.base_balance), get_symbol(base_currency)),
        }
        for r in rows
    ]

    return {
        "base_currency": base_currency,
        "currencies": currencies,
        "accounts": accounts,
        "as_of_date": str(to_date),
        "from_date": str(from_date),
        "to_date": str(to_date),
    }


# ============================================================
# CARD 2: RECEIVABLES (Currencies Only)
# ============================================================

@frappe.whitelist()
def get_receivables_balances(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Outstanding customer receivables as of `to_date`, grouped by currency.
    Includes mapping of corresponding Receivable Account for each currency.
    """
    from erpnext.accounts.report.accounts_receivable.accounts_receivable import (
        execute as run_accounts_receivable,
    )

    from_date, to_date = get_date_range(period_preset, from_date, to_date)
    report_date = getdate(to_date)

    companies = [company] if company else frappe.get_all("Company", pluck="name")

    base_currency = None
    if company:
        base_currency = frappe.get_cached_value("Company", company, "default_currency")
    if not base_currency:
        base_currency = frappe.defaults.get_global_default("currency") or "INR"

    currency_totals = {}
    currency_accounts = {}

    account_conditions = "account_type = 'Receivable' AND is_group = 0"
    params = {}
    if company:
        account_conditions += " AND company = %(company)s"
        params["company"] = company
    receivable_accs = frappe.db.sql(
        f"""
        SELECT name, account_name, account_currency, company
        FROM `tabAccount`
        WHERE {account_conditions}
        ORDER BY name
        """,
        params,
        as_dict=True,
    )
    acc_by_currency = {}
    for acc in receivable_accs:
        cur = acc.account_currency or base_currency
        if cur not in acc_by_currency or (company and acc.company == company):
            acc_by_currency[cur] = acc.name

    for cmp in companies:
        party_filters = frappe._dict({
            "company": cmp,
            "report_date": report_date,
            "in_party_currency": 1,
        })
        try:
            _, party_rows = run_accounts_receivable(party_filters)[:2]
            for r in party_rows:
                outstanding = flt(r.outstanding)
                if outstanding <= 0:
                    continue
                cur = r.currency or r.get("account_currency") or base_currency
                currency_totals[cur] = currency_totals.get(cur, 0) + outstanding
                if r.get("party_account") and cur not in currency_accounts:
                    currency_accounts[cur] = r.get("party_account")
        except Exception as e:
            frappe.log_error(f"Accounts Dashboard Receivables Error: {e}")

    currencies = [
        {
            "currency": cur,
            "balance": bal,
            "balance_fmt": fmt_money_full(bal, get_symbol(cur)),
            "account": currency_accounts.get(cur) or acc_by_currency.get(cur) or "",
        }
        for cur, bal in sorted(currency_totals.items())
    ]

    return {
        "base_currency": base_currency,
        "currencies": currencies,
        "as_of_date": str(to_date),
        "from_date": str(from_date),
        "to_date": str(to_date),
    }


# ============================================================
# CARD 3: AGING PAYABLES (Overall & Supplier Group Wise)
# ============================================================

AGING_PAYABLES_RANGE = "7,15,30,45"
AGING_PAYABLES_BUCKETS = [
    {"key": "day", "label": "1-7", "field": "range1"},
    {"key": "week", "label": "8-15", "field": "range2"},
    {"key": "month", "label": "16-30", "field": "range3"},
    {"key": "old30", "label": "31-45", "field": "range4"},
    {"key": "old45", "label": "46-ABOVE", "field": "range5"},
]

@frappe.whitelist()
def get_aging_payables(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Outstanding payables ageing snapshot for the selected period, with overall bucket totals
    and detailed breakdown by Supplier Group.
    """
    from erpnext.accounts.report.accounts_payable_summary.accounts_payable_summary import (
        execute as run_accounts_payable_summary,
    )

    from_date, to_date = get_date_range(period_preset, from_date, to_date)
    report_date = getdate(to_date or today())
    companies = [company] if company else frappe.get_all("Company", pluck="name")

    # Supplier group map
    supplier_groups = dict(frappe.db.sql("SELECT name, supplier_group FROM `tabSupplier`"))

    totals = {b["key"]: 0.0 for b in AGING_PAYABLES_BUCKETS}
    group_totals = {}

    for cmp in companies:
        filters = frappe._dict({
            "report_date": report_date,
            "range": AGING_PAYABLES_RANGE,
            "company": cmp,
            "ageing_based_on": "Due Date",
        })
        try:
            _, rows = run_accounts_payable_summary(filters)
            for r in rows:
                r = frappe._dict(r)
                party = r.get("party") or r.get("supplier")
                supp_group = r.get("supplier_group") or supplier_groups.get(party) or "All Other Suppliers"

                if supp_group not in group_totals:
                    group_totals[supp_group] = {
                        "supplier_group": supp_group,
                        "total": 0.0,
                        "day": 0.0,
                        "week": 0.0,
                        "month": 0.0,
                        "old30": 0.0,
                        "old45": 0.0,
                        "suppliers": set(),
                    }

                if party:
                    group_totals[supp_group]["suppliers"].add(party)

                row_total = 0.0
                for b in AGING_PAYABLES_BUCKETS:
                    b_val = max(flt(r.get(b["field"])), 0)
                    totals[b["key"]] += b_val
                    group_totals[supp_group][b["key"]] += b_val
                    row_total += b_val

                group_totals[supp_group]["total"] += row_total
        except Exception as e:
            frappe.log_error(f"Accounts Dashboard Aging Payables Error: {e}")

    grand_total = sum(g["total"] for g in group_totals.values()) or sum(totals.values())
    max_val = max(list(totals.values()) + [1])
    max_group_val = max([g["total"] for g in group_totals.values()] + [1])

    # Per-bucket supplier group distribution for stacked/segmented view
    items = []
    for b in AGING_PAYABLES_BUCKETS:
        b_key = b["key"]
        b_total = totals[b_key]
        b_groups = []
        for grp_name, g_data in sorted(group_totals.items(), key=lambda x: x[1][b_key], reverse=True):
            val = g_data[b_key]
            if val > 0:
                b_groups.append({
                    "supplier_group": grp_name,
                    "amount": val,
                    "amount_fmt": fmt_inr(val),
                    "pct_of_bucket": round((val / (b_total or 1)) * 100, 1),
                })
        items.append({
            "key": b["key"],
            "label": b["label"],
            "value_fmt": fmt_inr(b_total),
            "raw_value": b_total,
            "chart": round(b_total / max_val * 100, 1) if max_val else 0,
            "groups": b_groups,
        })

    by_supplier_group = []
    for grp_name, g_data in sorted(group_totals.items(), key=lambda x: x[1]["total"], reverse=True):
        if g_data["total"] <= 0:
            continue
        pct_of_total = round((g_data["total"] / (grand_total or 1)) * 100, 1)
        bar_pct = round((g_data["total"] / max_group_val) * 100, 1)
        by_supplier_group.append({
            "supplier_group": grp_name,
            "suppliers_count": len(g_data["suppliers"]),
            "total": g_data["total"],
            "total_fmt": fmt_inr(g_data["total"]),
            "pct_of_total": pct_of_total,
            "bar_pct": bar_pct,
            "day_fmt": fmt_inr(g_data["day"]),
            "week_fmt": fmt_inr(g_data["week"]),
            "month_fmt": fmt_inr(g_data["month"]),
            "old30_fmt": fmt_inr(g_data["old30"]),
            "old45_fmt": fmt_inr(g_data["old45"]),
            "day_raw": g_data["day"],
            "week_raw": g_data["week"],
            "month_raw": g_data["month"],
            "old30_raw": g_data["old30"],
            "old45_raw": g_data["old45"],
        })

    return {
        "items": items,
        "total": grand_total,
        "total_fmt": fmt_inr(grand_total),
        "by_supplier_group": by_supplier_group,
        "as_of_date": str(report_date),
        "from_date": str(from_date) if from_date else None,
        "to_date": str(to_date) if to_date else None,
    }


# ============================================================
# CARD 4: PENDING APPROVALS (Excluding Leave Application)
# ============================================================

PENDING_APPROVAL_TYPES = [
    {"key": "payment_request", "label": "Payment Request", "doctype": "Payment Request", "date_field": "transaction_date"},
    {"key": "expense_claim", "label": "Expense Claim", "doctype": "Expense Claim", "date_field": "posting_date"},
    {"key": "employee_advance", "label": "Employee Advance", "doctype": "Employee Advance", "date_field": "posting_date"},
]

def _doctype_has_field(doctype, fieldname):
    try:
        return bool(frappe.get_meta(doctype).has_field(fieldname))
    except Exception:
        return False


@frappe.whitelist()
def get_pending_approvals(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Count of documents awaiting workflow approval for:
      - Payment Request
      - Expense Claim
      - Employee Advance
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    items = []
    for cfg in PENDING_APPROVAL_TYPES:
        doctype = cfg["doctype"]

        if not frappe.db.exists("DocType", doctype):
            items.append({
                "key": cfg["key"], "label": cfg["label"], "count": 0,
                "doctype": doctype, "date_field": None, "has_workflow": False,
            })
            continue

        filters = [["docstatus", "=", 0]]

        date_field = cfg["date_field"] if _doctype_has_field(doctype, cfg["date_field"]) else "creation"
        if date_field == "creation":
            filters.append(["creation", "between", [from_date, to_date]])
        else:
            filters.append([date_field, "between", [from_date, to_date]])

        if company and _doctype_has_field(doctype, "company"):
            filters.append(["company", "=", company])

        has_workflow = _doctype_has_field(doctype, "workflow_state")
        if has_workflow:
            filters.append(["workflow_state", "is", "set"])
            filters.append(["workflow_state", "!=", "Draft"])

        count = frappe.db.count(doctype, filters=filters)

        items.append({
            "key": cfg["key"],
            "label": cfg["label"],
            "count": count,
            "doctype": doctype,
            "date_field": date_field,
            "has_workflow": has_workflow,
        })

    return {
        "items": items,
        "from_date": str(from_date),
        "to_date": str(to_date),
    }


# ============================================================
# CARD 5: PENDING PAYMENT ENTRY (Status = Draft)
# ============================================================

@frappe.whitelist()
def get_pending_payment_entries(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Returns count and total amount of Payment Entry records with docstatus = 0 (Draft).
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = "docstatus = 0 AND posting_date BETWEEN %(from_date)s AND %(to_date)s"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT
            name,
            posting_date,
            payment_type,
            party_type,
            party,
            party_name,
            paid_amount,
            received_amount,
            base_paid_amount,
            paid_from_account_currency,
            paid_to_account_currency,
            company
        FROM `tabPayment Entry`
        WHERE {conditions}
        ORDER BY posting_date DESC, creation DESC
        """,
        params,
        as_dict=True,
    )

    base_currency = None
    if company:
        base_currency = frappe.get_cached_value("Company", company, "default_currency")
    if not base_currency:
        base_currency = frappe.defaults.get_global_default("currency") or "INR"

    total_amount = 0.0
    items = []
    for r in rows:
        amt = flt(r.base_paid_amount) or flt(r.paid_amount) or flt(r.received_amount)
        total_amount += amt
        party_display = r.party_name or r.party or r.party_type or "-"
        cur = r.paid_from_account_currency or r.paid_to_account_currency or base_currency
        items.append({
            "name": r.name,
            "posting_date": frappe.utils.formatdate(r.posting_date),
            "payment_type": r.payment_type or "Pay",
            "party_type": r.party_type or "",
            "party": r.party or "",
            "party_display": party_display,
            "company": r.company,
            "amount": amt,
            "amount_fmt": fmt_money_full(amt, get_symbol(cur)),
            "status": "Draft",
        })

    return {
        "count": len(items),
        "total_amount": total_amount,
        "total_amount_fmt": fmt_inr(total_amount),
        "items": items,
        "from_date": str(from_date),
        "to_date": str(to_date),
    }


# ============================================================
# CARD 6: PENDING PURCHASE INVOICE (Status = Draft)
# ============================================================

@frappe.whitelist()
def get_pending_purchase_invoices(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Returns count and total amount of Purchase Invoice records with docstatus = 0 (Draft).
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = "docstatus = 0 AND posting_date BETWEEN %(from_date)s AND %(to_date)s"
    params = {"from_date": from_date, "to_date": to_date}
    if company:
        conditions += " AND company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT
            name,
            posting_date,
            supplier,
            supplier_name,
            bill_no,
            grand_total,
            base_grand_total,
            currency,
            company
        FROM `tabPurchase Invoice`
        WHERE {conditions}
        ORDER BY posting_date DESC, creation DESC
        """,
        params,
        as_dict=True,
    )

    base_currency = None
    if company:
        base_currency = frappe.get_cached_value("Company", company, "default_currency")
    if not base_currency:
        base_currency = frappe.defaults.get_global_default("currency") or "INR"

    total_amount = 0.0
    items = []
    for r in rows:
        amt = flt(r.base_grand_total) or flt(r.grand_total)
        total_amount += amt
        supplier_display = r.supplier_name or r.supplier or "-"
        cur = r.currency or base_currency
        items.append({
            "name": r.name,
            "posting_date": frappe.utils.formatdate(r.posting_date),
            "supplier": r.supplier or "",
            "supplier_display": supplier_display,
            "bill_no": r.bill_no or "",
            "company": r.company,
            "amount": amt,
            "amount_fmt": fmt_money_full(amt, get_symbol(cur)),
            "status": "Draft",
        })

    return {
        "count": len(items),
        "total_amount": total_amount,
        "total_amount_fmt": fmt_inr(total_amount),
        "items": items,
        "from_date": str(from_date),
        "to_date": str(to_date),
    }


# ============================================================
# CARD 7: FINANCIAL & COMPLIANCE PENDING (3 Cards)
# ============================================================

@frappe.whitelist()
def get_financial_compliance_pending(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Computes:
    - Pending Drawback: Sales Invoices (docstatus = 1) where drawback_received is not checked
    - Pending IGST: Sales Invoices (docstatus = 1) where igst_received is not checked
    - RODTEP Pending: Journal entries with voucher_type = 'RODTEP Entry'
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    conditions = ["si.docstatus = 1"]
    params = {}

    if from_date and to_date:
        conditions.append("si.posting_date BETWEEN %(from_date)s AND %(to_date)s")
        params["from_date"] = from_date
        params["to_date"] = to_date

    if company:
        conditions.append("si.company = %(company)s")
        params["company"] = company

    where_sql = " AND ".join(conditions)

    # 1. Pending Drawback (drawback_received is not checked)
    drawback_count = 0
    drawback_val = 0.0
    try:
        dbk_query = f"""
            SELECT 
                COUNT(si.name) as cnt,
                COALESCE(SUM(si.total_duty_drawback), 0) as total_val
            FROM `tabSales Invoice` si
            WHERE {where_sql} AND (si.drawback_received = 0 OR si.drawback_received IS NULL)
        """
        dbk_res = frappe.db.sql(dbk_query, params, as_dict=True)
        if dbk_res and dbk_res[0].get("cnt") is not None:
            drawback_count = dbk_res[0]["cnt"]
            drawback_val = flt(dbk_res[0]["total_val"])
    except Exception as e:
        frappe.log_error(f"Accounts Dashboard Drawback Query Error: {e}")

    # 2. Pending IGST (igst_received is not checked)
    igst_count = 0
    igst_val = 0.0
    try:
        igst_query = f"""
            SELECT 
                COUNT(DISTINCT si.name) as cnt,
                COALESCE(SUM(stc.base_tax_amount_after_discount_amount), 0) as total_val
            FROM `tabSales Invoice` si
            JOIN `tabSales Taxes and Charges` stc ON stc.parent = si.name
            WHERE {where_sql}
              AND (si.igst_received = 0 OR si.igst_received IS NULL)
              AND (stc.description LIKE '%%IGST%%' OR stc.account_head LIKE '%%IGST%%')
        """
        igst_res = frappe.db.sql(igst_query, params, as_dict=True)
        if igst_res and igst_res[0].get("cnt") is not None and igst_res[0]["cnt"] > 0:
            igst_count = igst_res[0]["cnt"]
            igst_val = flt(igst_res[0]["total_val"])
        else:
            fb_query = f"""
                SELECT 
                    COUNT(si.name) as cnt,
                    COALESCE(SUM(si.total_igst_amount), 0) as total_val
                FROM `tabSales Invoice` si
                WHERE {where_sql} AND (si.igst_received = 0 OR si.igst_received IS NULL)
            """
            fb_res = frappe.db.sql(fb_query, params, as_dict=True)
            if fb_res and fb_res[0].get("cnt") is not None:
                igst_count = fb_res[0]["cnt"]
                igst_val = flt(fb_res[0]["total_val"])
    except Exception as e:
        frappe.log_error(f"Accounts Dashboard IGST Query Error: {e}")

    # 3. RODTEP Pending
    rodtep_count = 0
    rodtep_val = 0.0
    try:
        excluded_jvs = []
        try:
            claim_conditions = ["rd.docstatus != 2"]
            claim_params = {}
            if company:
                claim_conditions.append("rd.company = %(company)s")
                claim_params["company"] = company

            claimed_res = frappe.db.sql(
                f"""
                SELECT rcm.je_no, rd.journal_entry_ref
                FROM `tabRodtep Details` rcm
                JOIN `tabRodtep Claim` rd ON rcm.parent = rd.name
                WHERE {' AND '.join(claim_conditions)}
                """,
                claim_params,
                as_dict=True,
            )
            for row in claimed_res:
                if row.get("je_no"):
                    excluded_jvs.append(str(row["je_no"]))
                if row.get("journal_entry_ref"):
                    excluded_jvs.append(str(row["journal_entry_ref"]))
        except Exception:
            pass

        rd_conditions = [
            "je.voucher_type = 'RODTEP Entry'",
            "je.docstatus < 2",
            "jea.debit_in_account_currency > 0",
        ]
        rd_params = {}

        if from_date and to_date:
            rd_conditions.append("je.posting_date BETWEEN %(from_date)s AND %(to_date)s")
            rd_params["from_date"] = from_date
            rd_params["to_date"] = to_date

        if company:
            rd_conditions.append("je.company = %(company)s")
            rd_params["company"] = company

        if excluded_jvs:
            rd_conditions.append("je.name NOT IN %(excluded_jvs)s")
            rd_params["excluded_jvs"] = tuple(set(excluded_jvs))

        rd_where_sql = " AND ".join(rd_conditions)
        rd_query = f"""
            SELECT 
                COUNT(DISTINCT je.name) as cnt,
                COALESCE(SUM(jea.debit_in_account_currency), 0) as total_val
            FROM `tabJournal Entry` je
            LEFT JOIN `tabJournal Entry Account` jea ON jea.parent = je.name
            LEFT JOIN `tabSales Invoice` si ON si.name = je.cheque_no
            WHERE {rd_where_sql}
        """
        rd_res = frappe.db.sql(rd_query, rd_params, as_dict=True)
        if rd_res and rd_res[0].get("cnt") is not None:
            rodtep_count = rd_res[0]["cnt"]
            rodtep_val = flt(rd_res[0]["total_val"])
    except Exception as e:
        frappe.log_error(f"Accounts Dashboard RODTEP Query Error: {e}")

    return {
        "pending_drawback": {
            "title": "PENDING DRAWBACK",
            "icon": "refresh",
            "color": "#3b82f6",
            "bg": "#eff6ff",
            "count": drawback_count,
            "count_label": "Invoices",
            "value": fmt_inr(drawback_val) if drawback_val else "₹ 0",
            "raw_value": drawback_val,
            "value_label": "TOTAL VALUE",
        },
        "pending_igst": {
            "title": "PENDING IGST",
            "icon": "percent",
            "color": "#8b5cf6",
            "bg": "#f5f3ff",
            "count": igst_count,
            "count_label": "Invoices",
            "value": fmt_inr(igst_val) if igst_val else "₹ 0",
            "raw_value": igst_val,
            "value_label": "TOTAL VALUE",
        },
        "rodtep_pending": {
            "title": "RODTEP PENDING",
            "icon": "claim",
            "color": "#10b981",
            "bg": "#ecfdf5",
            "count": rodtep_count,
            "count_label": "Claims",
            "value": fmt_inr(rodtep_val) if rodtep_val else "₹ 0",
            "raw_value": rodtep_val,
            "value_label": "EST. VALUE",
        },
        "from_date": str(from_date),
        "to_date": str(to_date),
    }


# ============================================================
# CARD 8: EBRC PENDING LIST (Table)
# ============================================================

@frappe.whitelist()
def get_ebrc_pending_list(period_preset="yearly", company=None, from_date=None, to_date=None, limit=10):
    """
    Returns pending draft records from DocType 'BRC Management' (docstatus = 0).
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    try:
        conditions = ["b.docstatus = 0"]
        params = {}

        if company:
            conditions.append("(si.company = %(company)s OR si.company IS NULL)")
            params["company"] = company

        if from_date and to_date:
            conditions.append("COALESCE(si.posting_date, DATE(b.creation)) BETWEEN %(from_date)s AND %(to_date)s")
            params["from_date"] = from_date
            params["to_date"] = to_date

        where_clause = " AND ".join(conditions)

        query = f"""
            SELECT 
                b.name,
                b.invoice_no,
                b.customer,
                b.currency,
                b.base_rounded_total,
                b.docstatus,
                b.creation,
                si.posting_date,
                si.company
            FROM `tabBRC Management` b
            LEFT JOIN `tabSales Invoice` si ON b.invoice_no = si.name
            WHERE {where_clause}
            ORDER BY b.creation DESC
            LIMIT {int(limit)}
        """
        records = frappe.db.sql(query, params, as_dict=True)

        if not records:
            fallback_query = f"""
                SELECT 
                    b.name,
                    b.invoice_no,
                    b.customer,
                    b.currency,
                    b.base_rounded_total,
                    b.docstatus,
                    b.creation,
                    si.posting_date,
                    si.company
                FROM `tabBRC Management` b
                LEFT JOIN `tabSales Invoice` si ON b.invoice_no = si.name
                WHERE b.docstatus = 0
                {"AND (si.company = %(company)s OR si.company IS NULL)" if company else ""}
                ORDER BY b.creation DESC
                LIMIT {int(limit)}
            """
            records = frappe.db.sql(fallback_query, params, as_dict=True)

        if records:
            live_records = []
            for r in records:
                cur = r.currency or "USD"
                sym = "$" if cur == "USD" else ("€" if cur == "EUR" else ("₹" if cur == "INR" else f"{cur} "))
                val_num = flt(r.base_rounded_total)
                val_fmt = f"{sym}{val_num:,.2f}"

                dt = r.posting_date or (getdate(r.creation) if r.creation else None)
                dt_str = format_date(dt, "dd MMM yyyy") if dt else "—"

                live_records.append({
                    "name": r.name,
                    "invoice_no": r.invoice_no or r.name,
                    "date": dt_str,
                    "customer": r.customer or "—",
                    "currency": cur,
                    "value": val_fmt,
                    "docstatus": 0,
                    "status": "Draft",
                })
            return live_records[:int(limit)]

    except Exception as e:
        frappe.log_error(f"Accounts Dashboard EBRC Query Error: {e}")

    return []


# ============================================================
# MODAL DRILLDOWN
# ============================================================

@frappe.whitelist()
def get_modal_drilldown(card_key, period_preset="yearly", company=None, from_date=None, to_date=None, supplier_group=None):
    """
    Returns row details when clicking "VIEW ALL" or drilldown for compliance/ebrc/supplier-group cards.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)

    if card_key in ("aging_supplier_groups", "aging_payables_supplier_group"):
        data = get_aging_payables(period_preset, company, from_date, to_date)
        groups = data.get("by_supplier_group") or []
        return {
            "title": "Aging Payables by Supplier Group",
            "subtitle": f"Total Due: {data.get('total_fmt')} (Live FIFO as of today)",
            "doctype": "Supplier Group",
            "card_key": "aging_supplier_groups",
            "columns": ["SUPPLIER GROUP", "SUPPLIERS", "1-7 DAYS", "8-15 DAYS", "16-30 DAYS", "31-45 DAYS", "46-ABOVE", "TOTAL DUE"],
            "rows": [
                [
                    g["supplier_group"],
                    g["suppliers_count"],
                    g["day_fmt"],
                    g["week_fmt"],
                    g["month_fmt"],
                    g["old30_fmt"],
                    g["old45_fmt"],
                    g["total_fmt"],
                ]
                for g in groups
            ],
        }

    if card_key in ("ebrc_all", "ebrc", "brc_management"):
        rows = get_ebrc_pending_list(period_preset, company, from_date, to_date, limit=100)
        return {
            "title": "EBRC Pending List (Draft Records)",
            "subtitle": f"Showing {len(rows)} draft records",
            "doctype": "BRC Management",
            "card_key": "ebrc_all",
            "columns": ["BRC NO", "INVOICE NO", "DATE", "CUSTOMER", "CURRENCY", "VALUE"],
            "rows": [
                [r["name"], r["invoice_no"], r["date"], r["customer"], r["currency"], r["value"]]
                for r in rows
            ],
        }

    if card_key in ("pending_drawback", "drawback_pending"):
        conditions = ["si.docstatus = 1", "(si.drawback_received = 0 OR si.drawback_received IS NULL)"]
        params = {}
        if from_date and to_date:
            conditions.append("si.posting_date BETWEEN %(from_date)s AND %(to_date)s")
            params["from_date"] = from_date
            params["to_date"] = to_date
        if company:
            conditions.append("si.company = %(company)s")
            params["company"] = company

        where_clause = " AND ".join(conditions)
        query = f"""
            SELECT 
                si.name,
                si.posting_date,
                si.customer,
                si.total_duty_drawback,
                si.currency
            FROM `tabSales Invoice` si
            WHERE {where_clause}
            ORDER BY si.posting_date DESC, si.creation DESC
            LIMIT 100
        """
        records = frappe.db.sql(query, params, as_dict=True) or []
        rows = []
        for r in records:
            dt = format_date(r.posting_date, "dd MMM yyyy") if r.posting_date else "—"
            amt = flt(r.total_duty_drawback)
            rows.append([
                r.name,
                dt,
                r.customer or "—",
                "Sales Invoice",
                f"₹ {amt:,.2f}",
                "Pending Drawback",
            ])
        return {
            "title": "Pending Duty Drawback",
            "subtitle": f"Submitted invoices pending drawback receipt ({len(rows)} records)",
            "doctype": "Sales Invoice",
            "card_key": "pending_drawback",
            "columns": ["INVOICE NO", "DATE", "CUSTOMER", "TYPE", "DRAWBACK AMT", "STATUS"],
            "rows": rows,
        }

    if card_key in ("pending_igst", "igst_pending"):
        conditions = ["si.docstatus = 1", "(si.igst_received = 0 OR si.igst_received IS NULL)"]
        params = {}
        if from_date and to_date:
            conditions.append("si.posting_date BETWEEN %(from_date)s AND %(to_date)s")
            params["from_date"] = from_date
            params["to_date"] = to_date
        if company:
            conditions.append("si.company = %(company)s")
            params["company"] = company

        where_clause = " AND ".join(conditions)
        query = f"""
            SELECT 
                si.name,
                si.posting_date,
                si.customer,
                COALESCE(SUM(stc.base_tax_amount_after_discount_amount), si.total_igst_amount, 0) as igst_amt
            FROM `tabSales Invoice` si
            JOIN `tabSales Taxes and Charges` stc ON stc.parent = si.name
            WHERE {where_clause}
              AND (stc.description LIKE '%%IGST%%' OR stc.account_head LIKE '%%IGST%%')
            GROUP BY si.name, si.posting_date, si.customer
            ORDER BY si.posting_date DESC, si.creation DESC
            LIMIT 100
        """
        records = frappe.db.sql(query, params, as_dict=True) or []
        rows = []
        for r in records:
            dt = format_date(r.posting_date, "dd MMM yyyy") if r.posting_date else "—"
            amt = flt(r.igst_amt)
            rows.append([
                r.name,
                dt,
                r.customer or "—",
                "Sales Invoice",
                f"₹ {amt:,.2f}",
                "Pending IGST",
            ])
        return {
            "title": "Pending IGST Refund",
            "subtitle": f"Submitted invoices pending IGST refund ({len(rows)} records)",
            "doctype": "Sales Invoice",
            "card_key": "pending_igst",
            "columns": ["INVOICE NO", "DATE", "CUSTOMER", "TYPE", "IGST AMT", "STATUS"],
            "rows": rows,
        }

    if card_key in ("rodtep_pending", "pending_rodtep"):
        excluded_jvs = []
        try:
            claim_conditions = ["rd.docstatus != 2"]
            claim_params = {}
            if company:
                claim_conditions.append("rd.company = %(company)s")
                claim_params["company"] = company

            claimed_res = frappe.db.sql(
                f"""
                SELECT rcm.je_no, rd.journal_entry_ref
                FROM `tabRodtep Details` rcm
                JOIN `tabRodtep Claim` rd ON rcm.parent = rd.name
                WHERE {' AND '.join(claim_conditions)}
                """,
                claim_params,
                as_dict=True,
            )
            for row in claimed_res:
                if row.get("je_no"):
                    excluded_jvs.append(str(row["je_no"]))
                if row.get("journal_entry_ref"):
                    excluded_jvs.append(str(row["journal_entry_ref"]))
        except Exception:
            pass

        rd_conditions = [
            "je.voucher_type = 'RODTEP Entry'",
            "je.docstatus < 2",
            "jea.debit_in_account_currency > 0",
        ]
        rd_params = {}

        if from_date and to_date:
            rd_conditions.append("je.posting_date BETWEEN %(from_date)s AND %(to_date)s")
            rd_params["from_date"] = from_date
            rd_params["to_date"] = to_date

        if company:
            rd_conditions.append("je.company = %(company)s")
            rd_params["company"] = company

        if excluded_jvs:
            rd_conditions.append("je.name NOT IN %(excluded_jvs)s")
            rd_params["excluded_jvs"] = tuple(set(excluded_jvs))

        rd_where_sql = " AND ".join(rd_conditions)
        query = f"""
            SELECT 
                je.name AS je_no,
                je.cheque_no AS si_no,
                je.posting_date,
                si.customer,
                jea.debit_in_account_currency AS amount
            FROM `tabJournal Entry` je
            LEFT JOIN `tabJournal Entry Account` jea ON jea.parent = je.name
            LEFT JOIN `tabSales Invoice` si ON si.name = je.cheque_no
            WHERE {rd_where_sql}
            ORDER BY je.posting_date DESC, je.creation DESC
            LIMIT 100
        """
        records = frappe.db.sql(query, rd_params, as_dict=True) or []
        rows = []
        for r in records:
            doc_id = r.si_no or r.je_no
            dt = format_date(r.posting_date, "dd MMM yyyy") if r.posting_date else "—"
            party = r.customer or "—"
            amt = flt(r.amount)
            rows.append([
                doc_id,
                dt,
                party,
                r.je_no,
                f"₹ {amt:,.2f}",
                "Pending Claim",
            ])
        return {
            "title": "Pending RODTEP Claims",
            "subtitle": f"Journal entries with voucher type RODTEP Entry awaiting claim ({len(rows)} records)",
            "doctype": "Sales Invoice",
            "card_key": "rodtep_pending",
            "columns": ["INVOICE NO", "DATE", "CUSTOMER", "JV NO", "RODTEP AMT", "STATUS"],
            "rows": rows,
        }

    return {
        "title": f"Details for {card_key.replace('_', ' ').title()}",
        "subtitle": "Detailed document records",
        "card_key": card_key,
        "columns": ["DOC ID", "DATE", "PARTY", "TYPE", "VALUE", "STATUS"],
        "rows": [],
    }


@frappe.whitelist()
def get_pending_drawback_list(period_preset="yearly", company=None, from_date=None, to_date=None, limit=10):
    """
    Returns pending duty drawback records from Sales Invoices with docstatus = 1 and drawback_received is not checked.
    """
    from_date, to_date = get_date_range(period_preset, from_date, to_date)
    conditions = ["si.docstatus = 1", "(si.drawback_received = 0 OR si.drawback_received IS NULL)"]
    params = {}
    if from_date and to_date:
        conditions.append("si.posting_date BETWEEN %(from_date)s AND %(to_date)s")
        params["from_date"] = from_date
        params["to_date"] = to_date
    if company:
        conditions.append("si.company = %(company)s")
        params["company"] = company

    where_clause = " AND ".join(conditions)
    query = f"""
        SELECT 
            si.name,
            si.posting_date,
            si.customer,
            si.total_duty_drawback,
            si.currency,
            si.grand_total,
            si.base_grand_total
        FROM `tabSales Invoice` si
        WHERE {where_clause}
        ORDER BY si.posting_date DESC, si.creation DESC
        LIMIT {int(limit)}
    """
    records = frappe.db.sql(query, params, as_dict=True) or []
    drawback_rows = []
    for r in records:
        dt = format_date(r.posting_date, "dd MMM yyyy") if r.posting_date else "—"
        amt = flt(r.total_duty_drawback)
        drawback_rows.append({
            "name": r.name,
            "date": dt,
            "customer": r.customer or "—",
            "type": "Sales Invoice",
            "drawback_amt": f"₹ {amt:,.2f}",
            "raw_amount": amt,
            "status": "Pending Drawback",
        })
    return drawback_rows


@frappe.whitelist()
def get_future_purchase_invoices_due(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Computes upcoming and future purchase invoice payables grouped by calendar periods:
    - Today: Invoices due today
    - This Week: Invoices due in current week (Mon - Sun, includes Today)
    - Next Week: Invoices due in next week (Mon - Sun)
    - This Month: Invoices due in current month (1st - Last day, includes Today & This Week)
    - Next Month: Invoices due in next month (1st - Last day)
    - This Quarter: Invoices due in current quarter (includes This Month)
    - Above Period: Invoices due after current quarter
    """
    today_date = getdate(today())

    # 1. Today
    today_start = today_date
    today_end = today_date

    # 2. This Week (From Today to Sunday of current week)
    weekday = today_date.isoweekday()  # Mon=1, Sun=7
    days_to_sunday = 7 - weekday
    this_week_start = today_date
    this_week_end = add_days(today_date, days_to_sunday) if days_to_sunday >= 0 else today_date

    # 3. Next Week (Monday to Sunday)
    next_week_start = add_days(this_week_end, 1)
    next_week_end = add_days(next_week_start, 6)

    # 4. This Month (From Today to last day of current month)
    this_month_start = today_date
    this_month_end = get_last_day(today_date)

    # 5. Next Month (1st to last day of next month)
    next_month_first = add_months(get_first_day(today_date), 1)
    next_month_start = next_month_first
    next_month_end = get_last_day(next_month_first)

    # 6. This Quarter (From Today to last day of current quarter)
    m = today_date.month
    if m in (4, 5, 6):
        this_quarter_end = getdate(f"{today_date.year}-06-30")
    elif m in (7, 8, 9):
        this_quarter_end = getdate(f"{today_date.year}-09-30")
    elif m in (10, 11, 12):
        this_quarter_end = getdate(f"{today_date.year}-12-31")
    else:
        this_quarter_end = getdate(f"{today_date.year}-03-31")

    this_quarter_start = today_date

    # 7. Above Period
    above_start = add_days(this_quarter_end, 1)

    this_week_label = format_date(today_date, "dd MMM yyyy") if this_week_start == this_week_end else f"{format_date(this_week_start, 'dd MMM')} - {format_date(this_week_end, 'dd MMM')}"
    this_month_label = format_date(today_date, "dd MMM yyyy") if this_month_start == this_month_end else f"{format_date(this_month_start, 'dd MMM')} - {format_date(this_month_end, 'dd MMM')}"
    this_quarter_label = f"{format_date(this_quarter_start, 'dd MMM')} - {format_date(this_quarter_end, 'dd MMM yyyy')}"

    bucket_defs = [
        {
            "key": "today",
            "label": "Today",
            "short_label": "Today",
            "from_date": str(today_start),
            "to_date": str(today_end),
            "op": "between",
            "date_range_label": format_date(today_date, "dd MMM yyyy"),
            "color": "#3b82f6",
        },
        {
            "key": "this_week",
            "label": "This Week",
            "short_label": "This Week",
            "from_date": str(this_week_start),
            "to_date": str(this_week_end),
            "op": "between",
            "date_range_label": this_week_label,
            "color": "#6366f1",
        },
        {
            "key": "next_week",
            "label": "Next Week",
            "short_label": "Next Week",
            "from_date": str(next_week_start),
            "to_date": str(next_week_end),
            "op": "between",
            "date_range_label": f"{format_date(next_week_start, 'dd MMM')} - {format_date(next_week_end, 'dd MMM')}",
            "color": "#8b5cf6",
        },
        {
            "key": "this_month",
            "label": "This Month",
            "short_label": "This Month",
            "from_date": str(this_month_start),
            "to_date": str(this_month_end),
            "op": "between",
            "date_range_label": this_month_label,
            "color": "#10b981",
        },
        {
            "key": "next_month",
            "label": "Next Month",
            "short_label": "Next Month",
            "from_date": str(next_month_start),
            "to_date": str(next_month_end),
            "op": "between",
            "date_range_label": format_date(next_month_first, "MMMM yyyy"),
            "color": "#06b6d4",
        },
        {
            "key": "this_quarter",
            "label": "This Quarter",
            "short_label": "This Quarter",
            "from_date": str(this_quarter_start),
            "to_date": str(this_quarter_end),
            "op": "between",
            "date_range_label": this_quarter_label,
            "color": "#f59e0b",
        },
        {
            "key": "above",
            "label": "Above Period",
            "short_label": "Above Period",
            "from_date": str(above_start),
            "to_date": "9999-12-31",
            "op": ">=",
            "date_range_label": f"After {format_date(this_quarter_end, 'dd MMM yyyy')}",
            "color": "#ec4899",
        },
    ]

    conditions = "pi.docstatus = 1 AND pi.outstanding_amount > 0"
    params = {}
    if company:
        conditions += " AND pi.company = %(company)s"
        params["company"] = company

    rows = frappe.db.sql(
        f"""
        SELECT
            pi.name,
            pi.due_date,
            pi.posting_date,
            pi.outstanding_amount,
            pi.grand_total,
            pi.base_grand_total,
            pi.conversion_rate
        FROM `tabPurchase Invoice` pi
        WHERE {conditions}
        ORDER BY pi.due_date ASC
        """,
        params,
        as_dict=True,
    )

    if not rows:
        return {
            "total_amount": 0.0,
            "total_amount_fmt": "₹ 0",
            "total_count": 0,
            "today_date": str(today_date),
            "buckets": [dict(b, count=0, amount=0.0, amount_fmt="₹ 0", amount_full_fmt="₹ 0.00", invoice_names=[]) for b in bucket_defs],
        }

    inv_names = [r.name for r in rows]
    schedules = frappe.db.sql(
        """
        SELECT
            parent,
            due_date,
            payment_amount,
            outstanding,
            paid_amount,
            base_payment_amount,
            base_outstanding
        FROM `tabPayment Schedule`
        WHERE parenttype = 'Purchase Invoice'
          AND parent IN %(inv_names)s
        ORDER BY parent, idx ASC
        """,
        {"inv_names": inv_names},
        as_dict=True,
    )

    schedules_by_parent = {}
    for s in schedules:
        schedules_by_parent.setdefault(s.parent, []).append(s)

    schedule_items = []
    for inv in rows:
        conv = flt(inv.conversion_rate) or 1.0
        inv_sched = schedules_by_parent.get(inv.name, [])

        if inv_sched:
            for s in inv_sched:
                due = getdate(s.due_date or inv.due_date or inv.posting_date)
                if not due or due < today_date:
                    continue

                if flt(s.base_outstanding) > 0:
                    s_amt = flt(s.base_outstanding)
                elif flt(s.outstanding) > 0:
                    s_amt = flt(s.outstanding) * conv
                elif flt(inv.outstanding_amount) == flt(inv.grand_total):
                    s_amt = flt(s.base_payment_amount) or (flt(s.payment_amount) * conv)
                else:
                    if flt(inv.grand_total) > 0:
                        ratio = flt(s.payment_amount) / flt(inv.grand_total)
                        s_amt = flt(inv.outstanding_amount) * ratio * conv
                    else:
                        s_amt = flt(s.base_payment_amount) or (flt(s.payment_amount) * conv)

                if s_amt > 0:
                    schedule_items.append({
                        "parent": inv.name,
                        "due_date": due,
                        "amount": s_amt,
                    })
        else:
            due = getdate(inv.due_date or inv.posting_date)
            if due and due >= today_date:
                inv_amt = flt(inv.outstanding_amount) * conv
                if inv_amt > 0:
                    schedule_items.append({
                        "parent": inv.name,
                        "due_date": due,
                        "amount": inv_amt,
                    })

    bucket_unique_invoices = {b["key"]: set() for b in bucket_defs}
    buckets = [dict(b, count=0, amount=0.0) for b in bucket_defs]

    for item in schedule_items:
        due = item["due_date"]
        amt = item["amount"]
        parent = item["parent"]

        for b in buckets:
            b_key = b["key"]
            if b["op"] == "between":
                f_d = getdate(b["from_date"])
                t_d = getdate(b["to_date"])
                if f_d <= due <= t_d:
                    b["amount"] += amt
                    bucket_unique_invoices[b_key].add(parent)
            elif b["op"] == ">=":
                f_d = getdate(b["from_date"])
                if due >= f_d:
                    b["amount"] += amt
                    bucket_unique_invoices[b_key].add(parent)

    for b in buckets:
        b_key = b["key"]
        b["count"] = len(bucket_unique_invoices[b_key])
        b["invoice_names"] = list(bucket_unique_invoices[b_key])
        b["amount_fmt"] = fmt_inr(b["amount"])
        b["amount_full_fmt"] = f"₹ {b['amount']:,.2f}"

    all_future_invoices = set(item["parent"] for item in schedule_items)
    total_amount = sum(item["amount"] for item in schedule_items)

    return {
        "total_amount": total_amount,
        "total_amount_fmt": fmt_inr(total_amount),
        "total_count": len(all_future_invoices),
        "today_date": str(today_date),
        "buckets": buckets,
    }


# ============================================================
# FULL PAGE DATA AGGREGATOR
# ============================================================

@frappe.whitelist()
def get_page_data(period_preset="yearly", company=None, from_date=None, to_date=None):
    """
    Aggregates all Accounts Dashboard data in a single fast call.
    """
    treasury = get_treasury_balances(period_preset, company, from_date, to_date)
    receivables = get_receivables_balances(period_preset, company, from_date, to_date)
    aging_payables = get_aging_payables(period_preset, company, from_date, to_date)
    future_pi_due = get_future_purchase_invoices_due(period_preset, company, from_date, to_date)
    pending_approvals = get_pending_approvals(period_preset, company, from_date, to_date)
    pending_payment_entries = get_pending_payment_entries(period_preset, company, from_date, to_date)
    pending_purchase_invoices = get_pending_purchase_invoices(period_preset, company, from_date, to_date)
    financial_compliance = get_financial_compliance_pending(period_preset, company, from_date, to_date)
    pending_drawback_list = get_pending_drawback_list(period_preset, company, from_date, to_date, limit=10)
    ebrc_pending_list = get_ebrc_pending_list(period_preset, company, from_date, to_date, limit=10)

    return {
        "treasury": treasury,
        "receivables": receivables,
        "aging_payables": aging_payables,
        "future_pi_due": future_pi_due,
        "pending_approvals": pending_approvals,
        "pending_payment_entries": pending_payment_entries,
        "pending_purchase_invoices": pending_purchase_invoices,
        "financial_compliance": financial_compliance,
        "pending_drawback_list": pending_drawback_list,
        "ebrc_pending_list": ebrc_pending_list,
    }
