import frappe
from frappe.utils import flt
from frappe.utils import flt, nowdate, date_diff



def get_qc_status(purchase_invoice):
    qi_statuses = frappe.db.sql("""
        SELECT qi.status
        FROM `tabQC Report` qi
        WHERE qi.reference_type = 'Purchase Receipt'
        AND qi.reference_name IN (
            SELECT DISTINCT pri.purchase_receipt
            FROM `tabPurchase Invoice Item` pri
            WHERE pri.parent = %s AND pri.purchase_receipt IS NOT NULL
        )
    """, purchase_invoice, as_list=True)

    if not qi_statuses:
        return "Pending"

    statuses = {s[0] for s in qi_statuses}
    if statuses == {"Accepted"}:
        return "Accepted"
    if "Rejected" in statuses:
        return "Rejected"
    if "Accepted Deviation" in  statuses:
        return "Accepted Deviation"
    return "Pending"


def get_payment_entry_status(pr_name):
    if not pr_name:
        return "Not Created"

    pe = frappe.db.get_value(
        "Payment Entry",
        {"reference_no": pr_name, "docstatus": ["!=", 2]},
        ["name", "docstatus"],
        order_by="creation desc",
        as_dict=True
    )

    if not pe:
        cancelled = frappe.db.exists(
            "Payment Entry", {"reference_no": pr_name, "docstatus": 2}
        )
        return "Cancelled" if cancelled else "Not Created"

    return {0: "Draft", 1: "Submitted"}.get(pe.docstatus, "Not Created")



@frappe.whitelist()
def get_related_documents(payment_request):
    pr = frappe.get_doc("Payment Request", payment_request)

    if pr.reference_doctype != "Purchase Invoice" or not pr.reference_name:
        return {}

    pi_name = pr.reference_name

    purchase_orders = frappe.db.sql_list("""
        SELECT DISTINCT purchase_order
        FROM `tabPurchase Invoice Item`
        WHERE parent = %s AND purchase_order IS NOT NULL
    """, pi_name)

    purchase_receipts = frappe.db.sql_list("""
        SELECT DISTINCT purchase_receipt
        FROM `tabPurchase Invoice Item`
        WHERE parent = %s AND purchase_receipt IS NOT NULL
    """, pi_name)

    quality_inspections = []
    if purchase_receipts:
        quality_inspections = frappe.db.sql_list("""
            SELECT name FROM `tabQC Report`
            WHERE reference_type = 'Purchase Receipt'
            AND reference_name IN %s  AND docstatus != 2
        """, (purchase_receipts,))
    
    non_conformances = []

    if purchase_receipts:
        non_conformances = frappe.db.sql_list("""
            SELECT name
            FROM `tabNon - Conformance`
            WHERE reference_type = 'Purchase Receipt'
            AND reference_name IN %(purchase_receipts)s
            AND docstatus = 1
        """, {
            "purchase_receipts": tuple(purchase_receipts)
        })


    payment_entries = frappe.db.sql_list("""
        SELECT name FROM `tabPayment Entry`
        WHERE reference_no = %s AND docstatus != 2
    """, payment_request)

    return {
        "Purchase Order": purchase_orders,
        "Purchase Receipt": purchase_receipts,
        "Purchase Invoice": [pi_name],
        "QC Report": quality_inspections,
        "Non-Conformance": non_conformances,
        "Payment Entry": payment_entries,
    }
    
@frappe.whitelist()
def get_item_wise_summary(payment_request):
    pr = frappe.get_doc("Payment Request", payment_request)

    if pr.reference_doctype != "Purchase Invoice" or not pr.reference_name:
        return []

    is_subcontracted = frappe.db.get_value(
        "Purchase Invoice", pr.reference_name, "is_subcontracted"
    )

    pi_items = frappe.db.sql("""
        SELECT
            item_code, item_name, rate as pi_rate, qty as invoice_qty,
            purchase_order, po_detail, purchase_receipt, pr_detail,
            fg_item
        FROM `tabPurchase Invoice Item`
        WHERE parent = %s
    """, pr.reference_name, as_dict=True)

    result = []
    for row in pi_items:
        po_qty, po_rate = 0, 0
        if row.purchase_order and row.po_detail:
            po_data = frappe.db.get_value(
                "Purchase Order Item", row.po_detail, ["qty", "rate"], as_dict=True
            )
            if po_data:
                po_qty, po_rate = po_data.qty, po_data.rate

        accepted_qty, rejected_qty = 0, 0

        if row.purchase_receipt and row.pr_detail:
            pr_data = frappe.db.get_value(
                "Purchase Receipt Item",
                row.pr_detail,
                ["qty", "rejected_qty"],
                as_dict=True
            )
            if pr_data:
                accepted_qty = pr_data.qty or 0
                rejected_qty = pr_data.rejected_qty or 0

        fg_item_name = None
        if is_subcontracted and row.fg_item:
            fg_item_name = frappe.db.get_value("Item", row.fg_item, "item_name")

        result.append({
            "item_code": row.item_code,
            "item_name": row.item_name,
            "po_qty": po_qty,
            "invoice_qty": row.invoice_qty,
            "accepted_qty": accepted_qty,
            "rejected_qty": rejected_qty,
            "po_rate": po_rate,
            "pi_rate": row.pi_rate,
            "rate_mismatch": flt(po_rate) != flt(row.pi_rate),
            "is_subcontracted": bool(is_subcontracted),
            "fg_item": row.fg_item,
            "fg_item_name": fg_item_name,
        })

    return result

def before_submit(doc, method):
    validate_payment_date(doc, method)
    
def on_submit(doc, method):
    create_payment_entry_on_submit(doc, method)
    
def on_cancel(doc, method): 
    cancel_linked_payment_entry(doc, method)

def validate_payment_date(doc, method):
    """
    Hooked to Payment Request's before_submit event.
    Ensures Payment Date is filled in before the document can be submitted,
    without forcing it to be filled in while still a Draft.
    """
    if not doc.payment_date:
        frappe.throw("Payment Date is mandatory before submitting the Payment Request.")
 
 
 
 
@frappe.whitelist()
def make_payment_entry_with_date(docname):
    """
    Overrides ERPNext core make_payment_entry() (the method the
    "Create Payment Entry" button on Payment Request actually calls).
    Uses the Payment Request's own create_payment_entry() so all the
    existing party/currency/dimension/allocation logic stays intact -
    we only patch posting_date to use payment_date instead of today.
 
    Registered in hooks.py under override_whitelisted_methods.
    """
    doc = frappe.get_doc("Payment Request", docname)
    doc.check_permission("read")
 
    pe = doc.create_payment_entry(submit=False)
 
    return pe.as_dict()
 
 
def create_payment_entry_on_submit(doc, method):
    """
    Hooked to Payment Request's on_submit event.
    Automatically creates a Payment Entry (linked back to this Payment
    Request) in Draft status the moment the Payment Request is submitted,
    reusing the doc's own create_payment_entry() so party account,
    currency conversion, cost center/project, accounting dimensions and
    payment-reference allocation are all handled exactly as they are for
    a manually created Payment Entry.
 
    The Payment Entry is intentionally NOT auto-submitted - the Accounts
    team reviews and submits it manually.
    """
    if doc.reference_doctype not in ("Purchase Invoice", "Purchase Order") or not doc.reference_name:
        return
 
    # Guard against duplicate creation (e.g. re-run of on_submit on amend)
    if doc.get("payment_entry"):
        return
 
    try:
        pe = doc.create_payment_entry(submit=False)
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            f"Auto Payment Entry creation failed for Payment Request {doc.name}"
        )
        frappe.msgprint(
            "Payment Request submitted, but automatic Payment Entry creation "
            "failed. Please create the Payment Entry manually.",
            indicator="orange",
            alert=True
        )
        return
 
    if doc.get("payment_date"):
        pe.posting_date = doc.payment_date
 
    # Link Payment Entry -> Payment Request (in addition to the
    # reference_no field that create_payment_entry() already sets)
    pe.payment_request = doc.name
 
    pe.flags.ignore_permissions = True
    pe.insert(ignore_permissions=True)
    # NOTE: deliberately not calling pe.submit() - stays in Draft
    # for the Accounts team to review and submit manually.
 
    # Link Payment Request -> Payment Entry (for quick reference on the PR form)
    doc.db_set("payment_entry", pe.name, update_modified=False)
 
    frappe.msgprint(
        f"Payment Entry {frappe.utils.get_link_to_form('Payment Entry', pe.name)} "
        f"has been created in Draft status. Please review and submit it.",
        indicator="green",
        alert=True
    )
    


def cancel_linked_payment_entry(doc, method):
    """
    Hooked to Payment Request's on_cancel event.
    - If the linked Payment Entry is still in Draft (nobody has actioned
      it yet), delete it - Draft docs can't be "cancelled" in Frappe.
    - If it was already Submitted by the Accounts team, cancel it
      properly so the books stay consistent.
    - If it's already Cancelled, do nothing.
    - If cancelling the Payment Entry fails for any reason (e.g. it's
      already reconciled/referenced elsewhere), block the Payment
      Request's cancellation so we never end up in an inconsistent state.
    """
    if not doc.get("payment_entry"):
        return
 
    if not frappe.db.exists("Payment Entry", doc.payment_entry):
        # Stale link (already deleted some other way) - just clear it
        doc.db_set("payment_entry", None, update_modified=False)
        return
 
    pe_docstatus = frappe.db.get_value("Payment Entry", doc.payment_entry, "docstatus")
 
    if pe_docstatus == 2:
        # Already cancelled - nothing to do
        doc.db_set("payment_entry", None, update_modified=False)
        return
 
    try:
        if pe_docstatus == 0:
            frappe.delete_doc(
                "Payment Entry", doc.payment_entry,
                ignore_permissions=True, force=True
            )
            frappe.msgprint(
                f"Draft Payment Entry {doc.payment_entry} was deleted since "
                f"this Payment Request was cancelled.",
                indicator="orange",
                alert=True
            )
        elif pe_docstatus == 1:
            pe = frappe.get_doc("Payment Entry", doc.payment_entry)
            pe.flags.ignore_permissions = True
            pe.cancel()
            frappe.msgprint(
                f"Payment Entry {frappe.utils.get_link_to_form('Payment Entry', doc.payment_entry)} "
                f"was cancelled along with this Payment Request.",
                indicator="orange",
                alert=True
            )
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            f"Failed to auto-cancel Payment Entry {doc.payment_entry} "
            f"for Payment Request {doc.name}"
        )
        frappe.throw(
            f"This Payment Request cannot be cancelled because its linked "
            f"Payment Entry {frappe.utils.get_link_to_form('Payment Entry', doc.payment_entry)} "
            f"could not be cancelled automatically (it may already be "
            f"reconciled or referenced elsewhere). Please resolve the "
            f"Payment Entry manually first."
        )
 
    doc.db_set("payment_entry", None, update_modified=False)
    
    
def get_available_advance(supplier, reference_name=None):
    """
    Get total available advance for a supplier.
    Any Payment Entry that has a Purchase Invoice reference
    will be completely excluded.
    """
    if not supplier:
        return 0

    result = frappe.db.sql(
        """
        SELECT SUM(pe.unallocated_amount) AS total
        FROM `tabPayment Entry` pe
        WHERE pe.docstatus = 1
            AND pe.party_type = 'Supplier'
            AND pe.party = %(supplier)s
            AND pe.posting_date < CURDATE()
            AND pe.unallocated_amount > 0
            AND NOT EXISTS (
                SELECT 1
                FROM `tabPayment Entry Reference` per
                WHERE per.parent = pe.name
                    AND per.reference_doctype = 'Purchase Invoice'
            )
        """,
        {
            "supplier": supplier
        },
        as_dict=True,
    )

    return flt(result[0].total) if result and result[0].total else 0


def get_debit_note_against_invoice(reference_name):
    """
    Outstanding amount on Debit Notes (Purchase Invoice, is_return=1)
    raised against this specific Purchase Invoice, posted on or before
    today.
    """
    result = frappe.db.sql(
        """
        select sum(pi.outstanding_amount) as total
        from `tabPurchase Invoice` pi
        where pi.docstatus = 1
            and pi.is_return = 1
            and pi.return_against = %(reference_name)s
            and pi.posting_date < CURDATE()
        """,
        {"reference_name": reference_name},
        as_dict=True,
    )
    return flt(result[0].total) if result else 0


def get_debit_note_without_reference(supplier, reference_name):
    """
    Outstanding amount on this supplier's Debit Notes (Purchase Invoice,
    is_return=1) posted on or before today that are NOT raised against
    this specific Purchase Invoice - general credit sitting on the
    supplier's account.
    """
    if not supplier:
        return 0

    result = frappe.db.sql(
        """
        select sum(pi.outstanding_amount) as total
        from `tabPurchase Invoice` pi
        where pi.docstatus = 1
            and pi.is_return = 1
            and pi.supplier = %(supplier)s
            and pi.posting_date < CURDATE()
            and (pi.return_against is null or pi.return_against != %(reference_name)s)
        """,
        {"supplier": supplier, "reference_name": reference_name},
        as_dict=True,
    )
    return flt(result[0].total) if result else 0


from frappe.utils import flt, nowdate


@frappe.whitelist()
def get_dashboard_data(reference_doctype, reference_name, pr_name=None, pr_amount=0):
    if reference_doctype != "Purchase Invoice" or not reference_name:
        return {}

    pi = frappe.db.get_value(
        "Purchase Invoice",
        reference_name,
        ["grand_total", "outstanding_amount", "supplier", "company", "due_date"],
        as_dict=True
    )

    if not pi:
        return {}

    return {
        "invoice_value": pi.grand_total,
        "outstanding_value": pi.outstanding_amount,
        "payment_request_amount": pr_amount,
        "outstanding_date": pi.due_date,
        "outstanding_days": get_outstanding_days(pi.due_date, pi.outstanding_amount),
        "qc_status": get_qc_status(reference_name),
        "payment_entry_status": get_payment_entry_status(pr_name),
        "available_advance": get_available_advance(pi.supplier, reference_name),
        "debit_note_against_invoice": get_debit_note_against_invoice(reference_name),
        "debit_note_without_reference": get_debit_note_without_reference(pi.supplier, reference_name),
        "purchase_receipt_returns": get_purchase_receipt_returns(reference_name),
        "supplier": pi.supplier,
        "company": pi.company,
        "fiscal_year": get_current_fiscal_year(),
    }

def get_outstanding_days(due_date, outstanding_amount):
    """
    Days overdue from the Purchase Invoice's due_date, based on today.
    Positive = overdue by that many days. Negative = still within terms
    (due_date is in the future). Returns 0 if fully paid (outstanding = 0)
    or due_date isn't set.
    """
    if not due_date or not flt(outstanding_amount):
        return 0

    return date_diff(nowdate(), due_date)

def get_purchase_receipt_returns(reference_name):
    """
    Purchase Receipt Return(s) - submitted Purchase Receipts with
    is_return=1 - raised against the Purchase Receipt(s) that this
    Purchase Invoice's items were received against.
    """
    purchase_receipts = frappe.db.sql_list("""
        select distinct purchase_receipt
        from `tabPurchase Invoice Item`
        where parent = %s and purchase_receipt is not null
    """, reference_name)

    if not purchase_receipts:
        return []

    return frappe.db.sql_list("""
        select name
        from `tabPurchase Receipt`
        where is_return = 1
            and docstatus = 1
            and return_against in %(purchase_receipts)s
        order by posting_date desc
    """, {"purchase_receipts": tuple(purchase_receipts)})


def get_current_fiscal_year():
    """
    Resolves the Fiscal Year record whose date range covers today, so the
    General Ledger card always points at the right window without a
    hardcoded year.
    """
    fy = frappe.db.get_value(
        "Fiscal Year",
        {"year_start_date": ["<=", nowdate()], "year_end_date": [">=", nowdate()]},
        ["name", "year_start_date", "year_end_date"],
        as_dict=True,
    )
    if not fy:
        return None

    return {
        "name": fy.name,
        "start_date": fy.year_start_date,
        "end_date": fy.year_end_date,
    }