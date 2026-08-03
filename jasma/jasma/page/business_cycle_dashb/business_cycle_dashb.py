"""Server-side data services for the unified business-cycle dashboard.

The implementation intentionally uses Frappe's permission-aware APIs. A user
only sees DocTypes and documents they are already allowed to read in Desk.
"""

from __future__ import annotations

from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, flt, nowdate


CYCLE_DEFINITIONS: dict[str, dict[str, Any]] = {
    "sales": {
        "label": "Sales Cycle",
        "description": "Lead to payment, including MEL engineering and production.",
        "accent": "blue",
        "stages": [
            ("Lead", "Lead"),
            ("Opportunity", "Opportunity"),
            ("TRS", "TRS"),
            ("Transformer Output Sheet", "Output Sheet"),
            ("Quotation", "Quotation"),
            ("BOM", "BOM"),
            ("Sales Order", "Sales Order"),
            ("Production Plan", "Production Plan"),
            ("Work Order", "Work Order"),
            ("Job Card", "Job Card"),
            ("Stock Entry", "Stock Entry"),
            ("Delivery Note", "Delivery Note"),
            ("Sales Invoice", "Sales Invoice"),
            ("Payment Entry", "Payment Entry"),
        ],
    },
    "purchase": {
        "label": "Purchase Cycle",
        "description": "Material demand to supplier payment and quality control.",
        "accent": "amber",
        "stages": [
            ("Material Request", "Material Request"),
            ("Request for Quotation", "RFQ"),
            ("Supplier Quotation", "Supplier Quotation"),
            ("Purchase Order", "Purchase Order"),
            ("Purchase Receipt", "Purchase Receipt"),
            ("Quality Inspection", "Quality Inspection"),
            ("Non - Conformance", "Non - Conformance"),
            ("Purchase Invoice", "Purchase Invoice"),
            ("Payment Entry", "Payment Entry"),
        ],
    },
    "subcontracting": {
        "label": "Subcontracting Cycle",
        "description": "Subcontract order, material transfer, receipt, inspection, and billing.",
        "accent": "violet",
        "stages": [
            ("BOM", "BOM"),
            ("Material Request", "Material Request"),
            ("Purchase Order", "Subcontracted PO"),
            ("Subcontracting Order", "Subcontracting Order"),
            ("Stock Entry", "Material Transfer"),
            ("Subcontracting Receipt", "Subcontracting Receipt"),
            ("Quality Inspection", "Quality Inspection"),
            ("Non - Conformance", "Non - Conformance"),
            ("Purchase Invoice", "Purchase Invoice"),
            ("Payment Entry", "Payment Entry"),
        ],
    },
}

DATE_FIELDS = (
    "transaction_date",
    "posting_date",
    "schedule_date",
    "required_by",
    "expected_delivery_date",
    "creation",
)
STATUS_FIELDS = ("workflow_state", "status")
PARTY_FIELDS = (
    "customer",
    "customer_name",
    "supplier",
    "supplier_name",
    "party_name",
    "lead_name",
    "company_name",
)
AMOUNT_FIELDS = (
    "grand_total",
    "rounded_total",
    "base_grand_total",
    "total",
    "paid_amount",
    "received_amount",
)
DUE_DATE_FIELDS = (
    "delivery_date",
    "schedule_date",
    "required_by",
    "due_date",
    "expected_delivery_date",
)
ITEM_FIELDS = (
    "item_code",
    "item_name",
    "description",
    "qty",
    "stock_qty",
    "received_qty",
    "delivered_qty",
    "rate",
    "amount",
    "warehouse",
    "uom",
)
PREVIEW_FIELD_PRIORITY = (
    "workflow_state",
    "status",
    "company",
    "customer",
    "customer_name",
    "supplier",
    "supplier_name",
    "party_name",
    "lead_name",
    "transaction_date",
    "posting_date",
    "schedule_date",
    "delivery_date",
    "due_date",
    "project",
    "currency",
    "grand_total",
    "rounded_total",
    "total",
    "outstanding_amount",
    "per_billed",
    "per_delivered",
)
SENSITIVE_FIELD_NAMES = {
    "password",
    "api_key",
    "api_secret",
    "secret",
    "token",
    "access_token",
}
RELATED_MASTER_DOCTYPES = {
    "Company",
    "Customer",
    "Supplier",
    "Item",
    "Project",
    "Warehouse",
    "Cost Center",
    "Sales Person",
}

# Contract expiry field candidates on Supplier doctype
_CONTRACT_EXPIRY_FIELD_CANDIDATES = (
    "contract_end_date",
    "end_date",
    "contract_expiry_date",
    "expiry_date",
    "valid_till",
    "valid_upto",
    "agreement_end_date",
)


def _validate_cycle(cycle: str) -> str:
    cycle = (cycle or "").strip().lower()
    if cycle not in CYCLE_DEFINITIONS:
        frappe.throw(_("Invalid business cycle."), frappe.ValidationError)
    return cycle


def _all_allowed_doctypes() -> set[str]:
    return {
        doctype
        for definition in CYCLE_DEFINITIONS.values()
        for doctype, _label in definition["stages"]
    }


def _all_related_doctypes() -> set[str]:
    return _all_allowed_doctypes() | RELATED_MASTER_DOCTYPES


def _doctype_exists(doctype: str) -> bool:
    return bool(frappe.db.exists("DocType", doctype))


def _has_field(meta: Any, fieldname: str) -> bool:
    return fieldname in {
        "name",
        "owner",
        "creation",
        "modified",
        "modified_by",
        "docstatus",
    } or bool(meta.has_field(fieldname))


def _first_supported_field(meta: Any, candidates: tuple[str, ...]) -> str | None:
    return next((fieldname for fieldname in candidates if _has_field(meta, fieldname)), None)


def _build_filters(
    doctype: str,
    company: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    party: str | None = None,
    cycle: str | None = None,
) -> tuple[dict[str, Any], str]:
    meta = frappe.get_meta(doctype)
    filters: dict[str, Any] = {}
    date_field = _first_supported_field(meta, DATE_FIELDS) or "creation"

    if company and _has_field(meta, "company"):
        filters["company"] = company

    if from_date and to_date:
        filters[date_field] = ["between", [from_date, to_date]]
    elif from_date:
        filters[date_field] = [">=", from_date]
    elif to_date:
        filters[date_field] = ["<=", to_date]

    if party:
        party_field = None
        if doctype == "Payment Entry" and _has_field(meta, "party"):
            party_field = "party"
        elif cycle == "sales":
            party_field = _first_supported_field(
                meta, ("customer", "party_name", "lead_name", "customer_name")
            )
        elif cycle in {"purchase", "subcontracting"}:
            party_field = _first_supported_field(
                meta, ("supplier", "party_name", "supplier_name")
            )
        if party_field:
            filters[party_field] = party

    if doctype == "Payment Entry" and _has_field(meta, "party_type"):
        filters["party_type"] = "Customer" if cycle == "sales" else "Supplier"

    if cycle == "subcontracting":
        if doctype == "Purchase Order" and _has_field(meta, "is_subcontracted"):
            filters["is_subcontracted"] = 1
        if doctype == "Stock Entry" and _has_field(meta, "stock_entry_type"):
            filters["stock_entry_type"] = "Send to Subcontractor"
        elif doctype == "Stock Entry" and _has_field(meta, "purpose"):
            filters["purpose"] = "Send to Subcontractor"
    elif cycle == "purchase":
        if doctype == "Purchase Order" and _has_field(meta, "is_subcontracted"):
            filters["is_subcontracted"] = 0

    return filters, date_field


def _permission_aware_count(doctype: str, filters: dict[str, Any]) -> int:
    result = frappe.get_list(
        doctype,
        filters=filters,
        fields=[{"COUNT": "name", "as": "total"}],
        limit_page_length=1,
    )
    return cint(result[0].get("total")) if result else 0


def _permission_aware_docstatus_counts(
    doctype: str, filters: dict[str, Any]
) -> dict[int, int]:
    result = frappe.get_list(
        doctype,
        filters=filters,
        fields=["docstatus", {"COUNT": "name", "as": "total"}],
        group_by="docstatus",
        limit_page_length=3,
    )
    return {cint(row.get("docstatus")): cint(row.get("total")) for row in result}


def _record_fields(meta: Any) -> list[str]:
    fields = ["name", "docstatus", "owner", "creation", "modified", "modified_by"]

    title_field = getattr(meta, "title_field", None)
    candidates = (
        *STATUS_FIELDS,
        *PARTY_FIELDS,
        *DATE_FIELDS,
        *AMOUNT_FIELDS,
        *DUE_DATE_FIELDS,
        "currency",
        "project",
    )
    if title_field:
        candidates = (title_field, *candidates)

    for fieldname in candidates:
        if _has_field(meta, fieldname) and fieldname not in fields:
            fields.append(fieldname)
    return fields


def _first_value(row: dict[str, Any], fields: tuple[str, ...]) -> Any:
    return next((row.get(fieldname) for fieldname in fields if row.get(fieldname) not in (None, "")), None)


def _status_from_row(row: dict[str, Any]) -> str:
    status = _first_value(row, STATUS_FIELDS)
    if status:
        return str(status)
    return {0: _("Draft"), 1: _("Submitted"), 2: _("Cancelled")}.get(
        cint(row.get("docstatus")), _("Unknown")
    )


def _serialize_record(doctype: str, row: dict[str, Any], meta: Any, date_field: str) -> dict[str, Any]:
    title_field = getattr(meta, "title_field", None)
    title = row.get(title_field) if title_field else None
    party = _first_value(row, PARTY_FIELDS)
    amount = _first_value(row, AMOUNT_FIELDS)
    due_date = _first_value(row, DUE_DATE_FIELDS)

    return {
        "doctype": doctype,
        "name": row.get("name"),
        "title": title or party or row.get("name"),
        "party": party,
        "date": row.get(date_field) or row.get("creation"),
        "due_date": due_date,
        "status": _status_from_row(row),
        "docstatus": cint(row.get("docstatus")),
        "amount": flt(amount) if amount not in (None, "") else None,
        "currency": row.get("currency"),
        "project": row.get("project"),
        "owner": row.get("owner"),
        "modified": row.get("modified"),
        "modified_by": row.get("modified_by"),
    }


def _get_records(
    doctype: str,
    filters: dict[str, Any],
    date_field: str,
    limit: int,
    search: str | None = None,
) -> list[dict[str, Any]]:
    meta = frappe.get_meta(doctype)
    fields = _record_fields(meta)
    or_filters: list[list[Any]] | None = None

    if search:
        searchable = ["name"]
        title_field = getattr(meta, "title_field", None)
        for fieldname in (title_field, *PARTY_FIELDS):
            if fieldname and _has_field(meta, fieldname) and fieldname not in searchable:
                searchable.append(fieldname)
        or_filters = [[doctype, fieldname, "like", f"%{search}%"] for fieldname in searchable]

    rows = frappe.get_list(
        doctype,
        filters=filters,
        or_filters=or_filters,
        fields=fields,
        order_by=f"{date_field} desc, modified desc",
        limit_page_length=limit,
    )
    return [_serialize_record(doctype, row, meta, date_field) for row in rows]


def _stage_payload(
    doctype: str,
    label: str,
    cycle: str,
    company: str | None,
    from_date: str | None,
    to_date: str | None,
    party: str | None,
    preview_limit: int,
) -> dict[str, Any]:
    if not _doctype_exists(doctype):
        return {
            "doctype": doctype,
            "label": label,
            "available": False,
            "can_read": False,
            "count": 0,
            "draft_count": 0,
            "submitted_count": 0,
            "records": [],
            "reason": _("DocType is not installed on this site."),
        }

    if not frappe.has_permission(doctype, ptype="read"):
        return {
            "doctype": doctype,
            "label": label,
            "available": True,
            "can_read": False,
            "count": 0,
            "draft_count": 0,
            "submitted_count": 0,
            "records": [],
            "reason": _("You do not have permission to read this DocType."),
        }

    filters, date_field = _build_filters(
        doctype, company, from_date, to_date, party, cycle
    )
    meta = frappe.get_meta(doctype)
    is_submittable = bool(meta.is_submittable)
    docstatus_counts = _permission_aware_docstatus_counts(doctype, filters)
    count = sum(docstatus_counts.values())
    draft_count = docstatus_counts.get(0, 0) if is_submittable else 0
    submitted_count = docstatus_counts.get(1, 0) if is_submittable else 0

    return {
        "doctype": doctype,
        "label": label,
        "available": True,
        "can_read": True,
        "count": count,
        "draft_count": draft_count,
        "submitted_count": submitted_count,
        "records": _get_records(doctype, filters, date_field, preview_limit),
        "date_field": date_field,
        "is_submittable": is_submittable,
    }


@frappe.whitelist()
def get_dashboard(
    cycle: str = "sales",
    company: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    party: str | None = None,
) -> dict[str, Any]:
    """Return a permission-aware dashboard snapshot for one business cycle."""
    cycle = _validate_cycle(cycle)
    definition = CYCLE_DEFINITIONS[cycle]
    stages = [
        _stage_payload(
            doctype,
            label,
            cycle,
            company,
            from_date,
            to_date,
            party,
            preview_limit=6,
        )
        for doctype, label in definition["stages"]
    ]

    readable = [stage for stage in stages if stage["can_read"]]
    summary = {
        "available_steps": len([stage for stage in stages if stage["available"]]),
        "documents": sum(stage["count"] for stage in readable),
        "drafts": sum(stage["draft_count"] for stage in readable),
        "submitted": sum(stage["submitted_count"] for stage in readable),
    }
    return {
        "cycle": cycle,
        "label": definition["label"],
        "description": definition["description"],
        "accent": definition["accent"],
        "as_of": nowdate(),
        "summary": summary,
        "stages": stages,
        "procurement_cards": _get_procurement_cards(company, from_date, to_date),
    }


# ── Child-table field map for document line-item fetching ────────────────────
_CHILD_TABLE_FIELDS: dict[str, tuple[str, list[str]]] = {
    "Material Request": (
        "Material Request Item",
        ["item_code", "item_name", "qty", "uom", "schedule_date", "warehouse"],
    ),
    "Purchase Order": (
        "Purchase Order Item",
        ["item_code", "item_name", "qty", "received_qty", "uom", "schedule_date", "rate"],
    ),
    "Purchase Receipt": (
        "Purchase Receipt Item",
        ["item_code", "item_name", "qty", "received_qty", "uom", "warehouse"],
    ),
    "Subcontracting Receipt": (
        "Subcontracting Receipt Item",
        ["item_code", "item_name", "qty", "received_qty", "uom"],
    ),
    "Subcontracting Order": (
        "Subcontracting Order Item",
        ["item_code", "item_name", "qty", "received_qty", "uom", "schedule_date"],
    ),
}


def _fetch_items_for_docs(
    doctype: str,
    doc_names: list[str],
    limit_per_doc: int = 10,
) -> dict[str, list[dict[str, Any]]]:
    """Return a dict of {doc_name: [item_rows]} for the given parent doctype.
    Fetches child items in a single batch query for efficiency.
    """
    if not doc_names:
        return {}
    child_info = _CHILD_TABLE_FIELDS.get(doctype)
    if not child_info:
        return {}
    child_dt, fields = child_info
    if not _doctype_exists(child_dt):
        return {}

    # Validate that all requested fields exist on the child table
    try:
        child_meta = frappe.get_meta(child_dt)
        safe_fields = ["parent", "idx"] + [f for f in fields if child_meta.has_field(f)]
    except Exception:
        return {}

    try:
        rows = frappe.get_all(
            child_dt,
            filters={"parent": ["in", doc_names]},
            fields=safe_fields,
            order_by="parent, idx",
            limit_page_length=len(doc_names) * limit_per_doc,
        )
    except Exception:
        return {}

    result: dict[str, list[dict[str, Any]]] = {}
    count_per_parent: dict[str, int] = {}
    for row in rows:
        parent = row.get("parent")
        if not parent:
            continue
        count_per_parent.setdefault(parent, 0)
        if count_per_parent[parent] >= limit_per_doc:
            continue
        count_per_parent[parent] += 1
        item_data = {
            "item_code": row.get("item_code") or "",
            "item_name": row.get("item_name") or row.get("item_code") or "",
            "qty": flt(row.get("qty")),
            "received_qty": flt(row.get("received_qty")),
            "uom": row.get("uom") or "",
            "schedule_date": str(row.get("schedule_date") or ""),
            "rate": flt(row.get("rate")),
            "warehouse": row.get("warehouse") or "",
        }
        result.setdefault(parent, []).append(item_data)
    return result


def _get_procurement_cards(
    company: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
) -> list[dict[str, Any]]:
    """Return dynamic card summaries and records directly from DocTypes."""
    today_date = frappe.utils.getdate(nowdate())
    cards = []

    # ── 1. MR To Be Approved ─────────────────────────────────────────────────
    if _doctype_exists("Material Request") and frappe.has_permission("Material Request", "read"):
        filters: dict[str, Any] = {"docstatus": 0}
        if company:
            filters["company"] = company
        records = frappe.get_list(
            "Material Request",
            filters=filters,
            fields=["name", "transaction_date", "material_request_type", "owner", "status", "project"],
            limit_page_length=50,
            order_by="modified desc",
        )
        card_recs = [
            {
                "ao": r.name,
                "date": str(r.transaction_date or ""),
                "item": r.material_request_type or "Material Request",
                "jpc": f"MR-{r.name[-4:]}",
                "status": r.status or "Draft",
                "who": r.owner or "—",
                "project": r.project or "",
                "doctype": "Material Request",
            }
            for r in records
        ]
        # Attach child items
        items_map = _fetch_items_for_docs("Material Request", [r.name for r in records])
        for rec in card_recs:
            rec["doc_items"] = items_map.get(rec["ao"], [])
        cards.append({
            "id": "mr_approved",
            "title": _("MR To Be Approved"),
            "doctype": "Material Request",
            "count": len(card_recs),
            "urg": False,
            "items": card_recs,
        })

    # ── 2. PO Creation Pending ───────────────────────────────────────────────
    if _doctype_exists("Material Request") and frappe.has_permission("Material Request", "read"):
        filters = {"docstatus": 1, "material_request_type": "Purchase"}
        if company:
            filters["company"] = company
        records = frappe.get_list(
            "Material Request",
            filters=filters,
            fields=["name", "transaction_date", "material_request_type", "owner", "status", "per_ordered", "project"],
            limit_page_length=50,
            order_by="modified desc",
        )
        records = [r for r in records if flt(r.get("per_ordered")) < 100 and r.get("status") != "Stopped"]
        card_recs = [
            {
                "ao": r.name,
                "date": str(r.transaction_date or ""),
                "item": f"Material Request ({r.name})",
                "jpc": f"MR-{r.name[-4:]}",
                "status": r.status or "Submitted",
                "who": r.owner or "—",
                "project": r.project or "",
                "doctype": "Material Request",
            }
            for r in records
        ]
        # Attach child items
        items_map = _fetch_items_for_docs("Material Request", [r.name for r in records])
        for rec in card_recs:
            rec["doc_items"] = items_map.get(rec["ao"], [])
        cards.append({
            "id": "po_pending",
            "title": _("PO Creation Pending"),
            "doctype": "Material Request",
            "count": len(card_recs),
            "urg": False,
            "items": card_recs,
        })

    # ── 3. Subcontracting PO Pending ─────────────────────────────────────────
    if _doctype_exists("Material Request") and frappe.has_permission("Material Request", "read"):
        filters = {"docstatus": 1}
        if company:
            filters["company"] = company
        mr_meta = frappe.get_meta("Material Request")
        mr_fields = ["name", "transaction_date", "material_request_type", "owner", "status", "per_ordered", "project"]
        if mr_meta.has_field("bom_no"):
            mr_fields.append("bom_no")
        records = frappe.get_list(
            "Material Request",
            filters=filters,
            fields=mr_fields,
            limit_page_length=50,
            order_by="modified desc",
        )
        records = [
            r for r in records
            if r.get("bom_no")
            and flt(r.get("per_ordered")) < 100
            and r.get("status") != "Stopped"
        ]
        card_recs = [
            {
                "ao": r.name,
                "date": str(r.transaction_date or ""),
                "item": r.get("bom_no") or r.name,
                "jpc": f"BOM-{r.name[-4:]}",
                "status": r.status or "Submitted",
                "who": r.owner or "—",
                "project": r.get("project") or "",
                "doctype": "Material Request",
            }
            for r in records
        ]
        # Attach child items
        items_map = _fetch_items_for_docs("Material Request", [r.name for r in records])
        for rec in card_recs:
            rec["doc_items"] = items_map.get(rec["ao"], [])
        cards.append({
            "id": "subcon_po",
            "title": _("Subcontracting PO Pending"),
            "doctype": "Material Request",
            "count": len(card_recs),
            "urg": False,
            "items": card_recs,
        })

    # ── 4. PR Pending ────────────────────────────────────────────────────────
    if _doctype_exists("Purchase Order") and frappe.has_permission("Purchase Order", "read"):
        filters = {"docstatus": 1}
        if company:
            filters["company"] = company
        records = frappe.get_list(
            "Purchase Order",
            filters=filters,
            fields=["name", "transaction_date", "supplier", "supplier_name", "owner", "status", "per_received"],
            limit_page_length=50,
            order_by="modified desc",
        )
        records = [
            r for r in records
            if flt(r.get("per_received")) < 100
            and r.get("status") not in ("Closed", "On Hold", "Delivered", "Completed")
        ]
        card_recs = [
            {
                "ao": r.name,
                "date": str(r.transaction_date or ""),
                "item": r.supplier_name or r.supplier or r.name,
                "jpc": f"PO-{r.name[-4:]}",
                "status": r.status or "To Receive",
                "who": r.owner or "—",
                "doctype": "Purchase Order",
            }
            for r in records
        ]
        # Attach child items
        items_map = _fetch_items_for_docs("Purchase Order", [r.name for r in records])
        for rec in card_recs:
            rec["doc_items"] = items_map.get(rec["ao"], [])
        cards.append({
            "id": "pr_pending",
            "title": _("PR Pending"),
            "doctype": "Purchase Order",
            "count": len(card_recs),
            "urg": False,
            "items": card_recs,
        })

    # ── 5. QC Pending ────────────────────────────────────────────────────────
    # Each record carries its own doctype for correct routing
    qc_recs: list[dict[str, Any]] = []
    for dt, prefix in (("Purchase Receipt", "GRN"), ("Subcontracting Receipt", "SCR")):
        if not _doctype_exists(dt) or not frappe.has_permission(dt, "read"):
            continue
        f: dict[str, Any] = {"docstatus": 0}
        if company:
            f["company"] = company
        recs = frappe.get_list(
            dt,
            filters=f,
            fields=["name", "posting_date", "supplier", "supplier_name", "owner", "status"],
            limit_page_length=20,
            order_by="modified desc",
        )
        for r in recs:
            qc_recs.append({
                "ao": r.name,
                "date": str(r.posting_date or ""),
                "item": r.supplier_name or r.supplier or r.name,
                "jpc": f"{prefix}-{r.name[-4:]}",
                "status": r.status or "Draft",
                "who": r.owner or "—",
                "doctype": dt,
            })
        # Attach child items per sub-doctype
        sub_names = [r.name for r in recs]
        sub_items_map = _fetch_items_for_docs(dt, sub_names)
        for rec in qc_recs:
            if rec["ao"] in sub_items_map:
                rec["doc_items"] = sub_items_map[rec["ao"]]
    cards.append({
        "id": "qc_pending",
        "title": _("QC Pending"),
        "doctype": "Purchase Receipt",
        "count": len(qc_recs),
        "urg": False,
        "items": qc_recs,
    })

    # ── 6. NC Pending ────────────────────────────────────────────────────────
    nc_doctype = (
        "Non - Conformance" if _doctype_exists("Non - Conformance")
        else "Non Conformance" if _doctype_exists("Non Conformance")
        else None
    )
    if nc_doctype and frappe.has_permission(nc_doctype, "read"):
        records = frappe.get_list(
            nc_doctype,
            filters={"docstatus": 0},
            fields=["name", "creation", "status", "product_name", "jasma_part_code", "owner"],
            limit_page_length=30,
            order_by="modified desc",
        )
        # Resolve product_name → Item doctype item_name in a single batch query
        product_codes = list({r.product_name for r in records if r.product_name})
        item_name_by_code: dict[str, str] = {}
        if product_codes:
            try:
                item_rows = frappe.get_all(
                    "Item",
                    filters={"name": ["in", product_codes]},
                    fields=["name", "item_name", "item_code"],
                )
                item_name_by_code = {row.name: row.item_name for row in item_rows if row.item_name}
            except Exception:
                pass

        card_recs = [
            {
                "ao": r.name,
                "date": str(r.creation).split(" ")[0] if r.creation else "",
                "item": item_name_by_code.get(r.product_name) or r.product_name or r.jasma_part_code or r.name,
                "jpc": r.jasma_part_code or f"NC-{r.name[-5:]}",
                "status": r.status or "Draft NC",
                "who": r.owner or "—",
                "doctype": nc_doctype,
            }
            for r in records
        ]
        cards.append({
            "id": "nc_pending",
            "title": _("NC Pending"),
            "doctype": nc_doctype,
            "count": len(card_recs),
            "urg": True,
            "items": card_recs,
        })

    # ── 7. Overdue PO ────────────────────────────────────────────────────────
    # Submitted POs where schedule_date is already past today, not Closed/On Hold/Completed.
    # If a linked PR exists, use its creation date to determine whether the PO is overdue.
    if _doctype_exists("Purchase Order") and frappe.has_permission("Purchase Order", "read"):
        filters = {"docstatus": 1}
        if company:
            filters["company"] = company
        records = frappe.get_list(
            "Purchase Order",
            filters=filters,
            fields=["name", "transaction_date", "schedule_date", "supplier", "supplier_name", "owner", "status", "per_received"],
            limit_page_length=50,
            order_by="modified desc",
        )
        po_names = [r.name for r in records if r.name]
        earliest_pr_dates = _get_po_earliest_pr_creation_dates(po_names)

        overdue_recs = []
        for r in records:
            if r.get("status") in ("Closed", "On Hold", "Delivered", "Completed"):
                continue
            if flt(r.get("per_received")) >= 100:
                continue

            sched = r.get("schedule_date") or r.get("transaction_date")
            if not sched:
                continue
            sched_date = frappe.utils.getdate(sched)
            pr_date = earliest_pr_dates.get(r.name)

            if pr_date and pr_date > sched_date:
                overdue = True
            elif not pr_date and sched_date < today_date:
                overdue = True
            else:
                overdue = False

            if overdue:
                overdue_recs.append({
                    "ao": r.name,
                    "date": str(r.transaction_date or ""),
                    "item": r.supplier_name or r.supplier or r.name,
                    "jpc": f"PO-{r.name[-4:]}",
                    "status": "Overdue PO",
                    "who": r.owner or "—",
                    "doctype": "Purchase Order",
                })
        # Attach child items
        items_map = _fetch_items_for_docs("Purchase Order", [r["ao"] for r in overdue_recs])
        for rec in overdue_recs:
            rec["doc_items"] = items_map.get(rec["ao"], [])
        cards.append({
            "id": "overdue_po",
            "title": _("Overdue PO"),
            "doctype": "Purchase Order",
            "count": len(overdue_recs),
            "urg": True,
            "items": overdue_recs,
        })

    return cards


def _get_po_earliest_pr_creation_dates(po_names: list[str]) -> dict[str, Any]:
    """Return the earliest Payment Request creation date per Purchase Order."""
    if not po_names:
        return {}
    if not _doctype_exists("Payment Request") or not _doctype_exists("Purchase Invoice") or not _doctype_exists("Purchase Invoice Item"):
        return {}

    try:
        rows = frappe.db.sql(
            """
            SELECT
                pii.purchase_order AS po_name,
                MIN(DATE(pr.creation)) AS pr_created_date
            FROM `tabPayment Request` pr
            JOIN `tabPurchase Invoice` pi ON pr.reference_doctype = 'Purchase Invoice' AND pr.reference_name = pi.name
            JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
            WHERE pr.docstatus != 2
              AND pii.purchase_order IN %(po_names)s
            GROUP BY pii.purchase_order
            """,
            {"po_names": tuple(po_names)},
            as_dict=True,
        )
        return {
            row.get("po_name"): frappe.utils.getdate(row.get("pr_created_date"))
            for row in rows
            if row.get("po_name")
        }
    except Exception:
        return {}


@frappe.whitelist()
def get_stage_records(
    cycle: str,
    doctype: str,
    company: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    party: str | None = None,
    search: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Return the live records shown in the selected-stage table."""
    cycle = _validate_cycle(cycle)
    allowed = {stage_doctype for stage_doctype, _label in CYCLE_DEFINITIONS[cycle]["stages"]}
    if doctype not in allowed:
        frappe.throw(_("DocType is not part of the selected cycle."), frappe.PermissionError)
    if not _doctype_exists(doctype):
        frappe.throw(_("DocType {0} is not installed.").format(frappe.bold(doctype)))
    if not frappe.has_permission(doctype, ptype="read"):
        frappe.throw(_("Not permitted to read {0}.").format(doctype), frappe.PermissionError)

    filters, date_field = _build_filters(
        doctype, company, from_date, to_date, party, cycle
    )
    limit = max(1, min(cint(limit) or 50, 200))
    return {
        "doctype": doctype,
        "count": _permission_aware_count(doctype, filters),
        "records": _get_records(
            doctype,
            filters,
            date_field,
            limit,
            (search or "").strip() or None,
        ),
        "date_field": date_field,
    }


def _field_label(meta: Any, fieldname: str) -> str:
    df = meta.get_field(fieldname)
    return (df.label if df else None) or fieldname.replace("_", " ").title()


def _preview_fields(doc: Any, meta: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    used: set[str] = set()
    fieldnames = list(PREVIEW_FIELD_PRIORITY)
    title_field = getattr(meta, "title_field", None)
    if title_field:
        fieldnames.insert(0, title_field)

    for fieldname in fieldnames:
        if fieldname in used or not _has_field(meta, fieldname):
            continue
        value = doc.get(fieldname)
        if value in (None, ""):
            continue
        df = meta.get_field(fieldname)
        if df and (df.hidden or df.fieldtype in {"Password", "Table", "Table MultiSelect"}):
            continue
        if fieldname.lower() in SENSITIVE_FIELD_NAMES:
            continue
        result.append(
            {
                "fieldname": fieldname,
                "label": _field_label(meta, fieldname),
                "fieldtype": df.fieldtype if df else "Data",
                "options": df.options if df else None,
                "value": value,
            }
        )
        used.add(fieldname)
        if len(result) >= 20:
            break

    allowed_fieldtypes = {
        "Data",
        "Small Text",
        "Text",
        "Link",
        "Dynamic Link",
        "Select",
        "Date",
        "Datetime",
        "Currency",
        "Float",
        "Int",
        "Check",
        "Percent",
    }
    for df in meta.fields:
        if len(result) >= 20:
            break
        if (
            df.fieldname in used
            or df.fieldname.lower() in SENSITIVE_FIELD_NAMES
            or df.hidden
            or not df.label
            or df.fieldtype not in allowed_fieldtypes
        ):
            continue
        value = doc.get(df.fieldname)
        if value in (None, ""):
            continue
        result.append(
            {
                "fieldname": df.fieldname,
                "label": df.label,
                "fieldtype": df.fieldtype,
                "options": df.options,
                "value": value,
            }
        )
        used.add(df.fieldname)
    return result


def _item_preview(doc: Any, meta: Any) -> dict[str, Any] | None:
    table_field = meta.get_field("items")
    if not table_field or table_field.fieldtype != "Table":
        return None

    rows = doc.get("items") or []
    if not rows:
        return None

    child_meta = frappe.get_meta(table_field.options)
    columns = [
        {
            "fieldname": fieldname,
            "label": _field_label(child_meta, fieldname),
            "fieldtype": child_meta.get_field(fieldname).fieldtype,
        }
        for fieldname in ITEM_FIELDS
        if child_meta.has_field(fieldname)
    ][:7]
    return {
        "columns": columns,
        "rows": [
            {column["fieldname"]: row.get(column["fieldname"]) for column in columns}
            for row in rows[:20]
        ],
        "total_rows": len(rows),
    }


def _linked_documents(doc: Any, meta: Any) -> list[dict[str, Any]]:
    allowed = _all_allowed_doctypes()
    related = _all_related_doctypes()
    connections: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for df in meta.fields:
        target_doctype = None
        if df.fieldtype == "Link":
            target_doctype = df.options
        elif df.fieldtype == "Dynamic Link" and df.options:
            target_doctype = doc.get(df.options)
        if target_doctype not in related:
            continue
        value = doc.get(df.fieldname)
        key = (target_doctype, str(value)) if value else None
        if (
            key
            and key not in seen
            and _doctype_exists(target_doctype)
            and frappe.has_permission(target_doctype, ptype="read")
        ):
            connections.append(
                {
                    "doctype": target_doctype,
                    "name": value,
                    "label": df.label or target_doctype,
                    "direction": "outgoing",
                }
            )
            seen.add(key)

    for candidate in sorted(allowed):
        if len(connections) >= 18:
            break
        if (
            candidate == doc.doctype
            or not _doctype_exists(candidate)
            or not frappe.has_permission(candidate, ptype="read")
        ):
            continue
        candidate_meta = frappe.get_meta(candidate)
        link_fields = [
            df.fieldname
            for df in candidate_meta.fields
            if df.fieldtype == "Link" and df.options == doc.doctype
        ]
        for fieldname in link_fields[:2]:
            rows = frappe.get_list(
                candidate,
                filters={fieldname: doc.name},
                fields=["name"],
                order_by="modified desc",
                limit_page_length=4,
            )
            for row in rows:
                key = (candidate, row.name)
                if key in seen:
                    continue
                connections.append(
                    {
                        "doctype": candidate,
                        "name": row.name,
                        "label": candidate,
                        "direction": "incoming",
                    }
                )
                seen.add(key)
                if len(connections) >= 18:
                    break

    return connections


@frappe.whitelist()
def get_document_preview(doctype: str, name: str) -> dict[str, Any]:
    """Return a safe preview plus connected cycle documents for the side panel."""
    if doctype not in _all_allowed_doctypes():
        frappe.throw(_("Unsupported DocType."), frappe.PermissionError)
    if not _doctype_exists(doctype):
        frappe.throw(_("DocType {0} is not installed.").format(frappe.bold(doctype)))

    doc = frappe.get_doc(doctype, name)
    doc.check_permission("read")
    meta = frappe.get_meta(doctype)

    return {
        "doctype": doctype,
        "name": doc.name,
        "title": doc.get(getattr(meta, "title_field", None)) if getattr(meta, "title_field", None) else doc.name,
        "docstatus": cint(doc.docstatus),
        "fields": _preview_fields(doc, meta),
        "items": _item_preview(doc, meta),
        "connections": _linked_documents(doc, meta),
        "audit": {
            "owner": doc.owner,
            "creation": doc.creation,
            "modified_by": doc.modified_by,
            "modified": doc.modified,
        },
    }


def _get_bom_component_map() -> dict[str, list[dict[str, Any]]]:
    """Return component_item_code -> list of {parent_item, qty_per_unit} from active default BOMs."""
    if not _doctype_exists("BOM"):
        return {}

    bom_items = frappe.db.sql(
        """
        SELECT
            b.item AS parent_item,
            bi.item_code AS component_item,
            (bi.qty / IFNULL(NULLIF(b.quantity, 0), 1)) AS qty_per_unit
        FROM `tabBOM Item` bi
        JOIN `tabBOM` b ON bi.parent = b.name
        WHERE b.docstatus = 1 AND b.is_active = 1
        """,
        as_dict=True,
    )

    comp_map: dict[str, list[dict[str, Any]]] = {}
    for row in bom_items:
        comp = row.get("component_item")
        if not comp:
            continue
        if comp not in comp_map:
            comp_map[comp] = []
        comp_map[comp].append({
            "parent_item": row.get("parent_item"),
            "qty_per_unit": flt(row.get("qty_per_unit")),
        })
    return comp_map


def _get_overdue_po_qty_by_item() -> dict[str, dict[str, Any]]:
    """Return dict of item_code -> {total_qty, details:[{po, qty, type, required_date}]}
    for Purchase Order items + Subcontracting Order items past their required date and not fully received.
    """
    today_date = frappe.utils.getdate(nowdate())
    result: dict[str, dict[str, Any]] = {}

    # Purchase Order items overdue
    if _doctype_exists("Purchase Order Item") and frappe.has_permission("Purchase Order", "read"):
        po_items = frappe.db.sql(
            """
            SELECT
                poi.item_code,
                poi.item_name,
                poi.qty,
                poi.received_qty,
                poi.schedule_date,
                poi.parent AS po_name,
                po.status,
                po.supplier_name,
                po.supplier
            FROM `tabPurchase Order Item` poi
            JOIN `tabPurchase Order` po ON poi.parent = po.name
            WHERE po.docstatus = 1
              AND po.status NOT IN ('Closed', 'On Hold', 'Completed')
              AND poi.qty > IFNULL(poi.received_qty, 0)
              AND poi.schedule_date < %s
            """,
            (today_date,),
            as_dict=True,
        )
        for r in po_items:
            code = r.get("item_code")
            if not code:
                continue
            pending_qty = flt(r.get("qty")) - flt(r.get("received_qty"))
            if pending_qty <= 0:
                continue
            if code not in result:
                result[code] = {"total_qty": 0.0, "details": []}
            result[code]["total_qty"] += pending_qty
            result[code]["details"].append({
                "doc": r.get("po_name"),
                "qty": round(pending_qty, 2),
                "type": "Purchase Order",
                "required_date": str(r.get("schedule_date") or "—"),
                "supplier": r.get("supplier_name") or r.get("supplier") or "—",
            })

    # Subcontracting Order items overdue
    if _doctype_exists("Subcontracting Order Item") and frappe.has_permission("Subcontracting Order", "read"):
        sc_items = frappe.db.sql(
            """
            SELECT
                soi.item_code,
                soi.item_name,
                soi.qty,
                IFNULL(soi.received_qty, 0) AS received_qty,
                so.schedule_date,
                soi.parent AS sc_name,
                so.status,
                so.supplier_name,
                so.supplier
            FROM `tabSubcontracting Order Item` soi
            JOIN `tabSubcontracting Order` so ON soi.parent = so.name
            WHERE so.docstatus = 1
              AND so.status NOT IN ('Closed', 'Completed')
              AND soi.qty > IFNULL(soi.received_qty, 0)
              AND so.schedule_date < %s
            """,
            (today_date,),
            as_dict=True,
        )
        for r in sc_items:
            code = r.get("item_code")
            if not code:
                continue
            pending_qty = flt(r.get("qty")) - flt(r.get("received_qty"))
            if pending_qty <= 0:
                continue
            if code not in result:
                result[code] = {"total_qty": 0.0, "details": []}
            result[code]["total_qty"] += pending_qty
            result[code]["details"].append({
                "doc": r.get("sc_name"),
                "qty": round(pending_qty, 2),
                "type": "Subcontracting Order",
                "required_date": str(r.get("schedule_date") or "—"),
                "supplier": r.get("supplier_name") or r.get("supplier") or "—",
            })

    return result


@frappe.whitelist()
def get_pending_po_details(item_code: str | None = None) -> list[dict[str, Any]]:
    """Return list of overdue PO / Subcontracting Order details for an item (for dialog)."""
    if not item_code:
        return []
    overdue_map = _get_overdue_po_qty_by_item()
    entry = overdue_map.get(item_code)
    if not entry:
        return []
    return entry.get("details", [])


@frappe.whitelist()
def get_stock_overview(search: str | None = None) -> list[dict[str, Any]]:
    """Return stock overview with Bin valuation, Sales Order + BOM commitments, Quotation + BOM forecasts,
    and overdue PO qty (not yet received past required date)."""
    if not frappe.has_permission("Item", "read"):
        return []

    filters = {}
    if search:
        filters["item_name"] = ["like", f"%{search}%"]

    items = frappe.get_list(
        "Item",
        filters=filters,
        fields=["name", "item_code", "item_name", "valuation_rate", "standard_rate"],
        limit_page_length=50,
        order_by="modified desc",
    )

    so_pending_by_item: dict[str, float] = {}
    if _doctype_exists("Sales Order Item"):
        so_rows = frappe.db.sql(
            """
            SELECT item_code, SUM(qty - delivered_qty) AS pending_qty
            FROM `tabSales Order Item`
            WHERE docstatus = 1 AND qty > delivered_qty
            GROUP BY item_code
            """,
            as_dict=True,
        )
        for r in so_rows:
            if r.get("item_code"):
                so_pending_by_item[r.get("item_code")] = flt(r.get("pending_qty"))

    quot_by_item: dict[str, float] = {}
    if _doctype_exists("Quotation Item"):
        q_rows = frappe.db.sql(
            """
            SELECT item_code, SUM(qty) AS forecast_qty
            FROM `tabQuotation Item`
            WHERE docstatus = 1
            GROUP BY item_code
            """,
            as_dict=True,
        )
        for r in q_rows:
            if r.get("item_code"):
                quot_by_item[r.get("item_code")] = flt(r.get("forecast_qty"))

    comp_map = _get_bom_component_map()
    overdue_po_map = _get_overdue_po_qty_by_item()

    result = []
    for it in items:
        code = it.get("item_code") or it.get("name")

        val_rate = 0.0
        bin_records = frappe.get_all(
            "Bin",
            filters={"item_code": code},
            fields=["valuation_rate", "actual_qty", "ordered_qty"],
            order_by="modified desc",
        )
        for b in bin_records:
            v = flt(b.get("valuation_rate"))
            if v > 0:
                val_rate = v
                break

        if val_rate <= 0:
            val_rate = flt(it.get("valuation_rate")) or flt(it.get("standard_rate")) or 0.0

        total_stock = sum(flt(b.get("actual_qty")) for b in bin_records)

        direct_so_qty = flt(so_pending_by_item.get(code, 0.0))
        indirect_so_qty = 0.0
        for p_info in comp_map.get(code, []):
            p_item = p_info["parent_item"]
            ratio = p_info["qty_per_unit"]
            p_so_qty = flt(so_pending_by_item.get(p_item, 0.0))
            if p_so_qty > 0 and ratio > 0:
                indirect_so_qty += p_so_qty * ratio

        export_commitment = direct_so_qty + indirect_so_qty

        direct_q_qty = flt(quot_by_item.get(code, 0.0))
        indirect_q_qty = 0.0
        for p_info in comp_map.get(code, []):
            p_item = p_info["parent_item"]
            ratio = p_info["qty_per_unit"]
            p_q_qty = flt(quot_by_item.get(p_item, 0.0))
            if p_q_qty > 0 and ratio > 0:
                indirect_q_qty += p_q_qty * ratio

        export_forecast = direct_q_qty + indirect_q_qty

        # Overdue PO qty (not yet received past required date)
        overdue_info = overdue_po_map.get(code, {})
        pending_po_qty = round(flt(overdue_info.get("total_qty", 0.0)), 2)

        result.append({
            "item": it.get("item_name") or code,
            "item_code": code,
            "jpc": f"JPC-{code[-4:]}" if len(code) >= 4 else f"JPC-{code}",
            "rate": val_rate,
            "stock": total_stock,
            "pending_po_qty": pending_po_qty,   # overdue PO qty
            "pending": round(export_commitment, 2),  # kept for backward compat
            "export": round(export_commitment, 2),
            "export_forecast": round(export_forecast, 2),
        })

    return result


def _get_contract_expiry_field() -> str | None:
    """Detect which field on the Supplier doctype stores the contract expiry date."""
    try:
        meta = frappe.get_meta("Supplier")
        for candidate in _CONTRACT_EXPIRY_FIELD_CANDIDATES:
            if meta.has_field(candidate):
                return candidate
    except Exception:
        pass
    return None


@frappe.whitelist()
def get_supplier_performance(search: str | None = None) -> list[dict[str, Any]]:
    """Return permission-aware supplier performance analysis with:
    - NC count filtered per supplier
    - PO delay based on receipt date vs required date (for received POs)
      or today vs required date (for open overdue POs)
    - Contract expiry color status
    """
    if not frappe.has_permission("Supplier", "read"):
        return []

    filters = {}
    if search:
        filters["supplier_name"] = ["like", f"%{search}%"]

    suppliers = frappe.get_list(
        "Supplier",
        filters=filters,
        fields=["name", "supplier_name"],
        limit_page_length=30,
        order_by="modified desc",
    )

    today_date = frappe.utils.getdate(nowdate())
    nc_doctype = (
        "Non - Conformance" if _doctype_exists("Non - Conformance")
        else "Non Conformance" if _doctype_exists("Non Conformance")
        else None
    )

    # Check if NC doctype has supplier field
    nc_has_supplier = False
    if nc_doctype:
        try:
            nc_meta = frappe.get_meta(nc_doctype)
            nc_has_supplier = nc_meta.has_field("supplier")
        except Exception:
            pass

    result = []
    for sup in suppliers:
        s_name = sup.get("supplier_name") or sup.get("name")
        s_code = sup.get("name")

        pos = frappe.get_all(
            "Purchase Order",
            filters={"supplier": s_code, "docstatus": 1},
            fields=["name", "grand_total", "docstatus", "transaction_date", "schedule_date", "status", "per_received"],
        )
        order_count = len(pos)
        total_val = sum(flt(p.get("grand_total")) for p in pos)

        # Build receipt date map for received POs
        po_names = [p.get("name") for p in pos if p.get("name")]
        receipt_date_by_po: dict[str, Any] = {}
        if po_names and _doctype_exists("Purchase Receipt Item"):
            try:
                receipts = frappe.db.sql(
                    """
                    SELECT pri.purchase_order AS po_name, MIN(pr.posting_date) AS receipt_date
                    FROM `tabPurchase Receipt Item` pri
                    JOIN `tabPurchase Receipt` pr ON pri.parent = pr.name
                    WHERE pr.docstatus = 1
                      AND pri.purchase_order IN %(po_names)s
                    GROUP BY pri.purchase_order
                    """,
                    {"po_names": po_names},
                    as_dict=True,
                )
                for r in receipts:
                    receipt_date_by_po[r.get("po_name")] = r.get("receipt_date")
            except Exception:
                pass

        delayed_count = 0
        total_delay_days = 0

        for p in pos:
            sched = p.get("schedule_date") or p.get("transaction_date")
            if not sched:
                continue
            sched_date = frappe.utils.getdate(sched)

            receipt_date = receipt_date_by_po.get(p.get("name"))
            if receipt_date:
                # PO received: measure delay as receipt_date - schedule_date
                receipt_dt = frappe.utils.getdate(receipt_date)
                diff = (receipt_dt - sched_date).days
                if diff > 0:
                    delayed_count += 1
                    total_delay_days += diff
            else:
                # PO not yet received: measure delay as today - schedule_date
                if sched_date < today_date and flt(p.get("per_received")) < 100:
                    if p.get("status") not in ("Closed", "On Hold", "Completed"):
                        diff = (today_date - sched_date).days
                        if diff > 0:
                            delayed_count += 1
                            total_delay_days += diff

        avg_delay_days = round(total_delay_days / delayed_count, 1) if delayed_count else 0.0

        # NC count — linked via reference_name (Purchase Receipt) or reference_type (Purchase Order)
        nc_count = 0
        if nc_doctype and frappe.has_permission(nc_doctype, "read"):
            try:
                nc_meta = frappe.get_meta(nc_doctype)
                if nc_has_supplier:
                    # Direct supplier field on NC
                    nc_count = frappe.db.count(
                        nc_doctype,
                        filters={"supplier": s_code, "docstatus": ["!=", 2]},
                    )
                elif nc_meta.has_field("reference_name") and nc_meta.has_field("reference_type"):
                    # NC links to Purchase Receipt via reference_name / reference_type.
                    # Step 1: get GRN names for this supplier's POs.
                    grn_names: list[str] = []
                    if po_names and _doctype_exists("Purchase Receipt Item"):
                        grn_rows = frappe.db.sql(
                            """
                            SELECT DISTINCT pri.parent AS grn
                            FROM `tabPurchase Receipt Item` pri
                            JOIN `tabPurchase Receipt` pr ON pri.parent = pr.name
                            WHERE pr.docstatus = 1
                              AND pri.purchase_order IN %(po_names)s
                            """,
                            {"po_names": po_names},
                            as_dict=True,
                        )
                        grn_names = [r.get("grn") for r in grn_rows if r.get("grn")]

                    # Step 2: count NCs referencing those GRNs
                    if grn_names:
                        nc_count += frappe.db.count(
                            nc_doctype,
                            filters={
                                "reference_type": "Purchase Receipt",
                                "reference_name": ["in", grn_names],
                                "docstatus": ["!=", 2],
                            },
                        )

                    # Step 3: also count NCs referencing the POs directly
                    if po_names and nc_meta.has_field("reference_name"):
                        nc_count += frappe.db.count(
                            nc_doctype,
                            filters={
                                "reference_type": "Purchase Order",
                                "reference_name": ["in", po_names],
                                "docstatus": ["!=", 2],
                            },
                        )

                elif po_names and nc_meta.has_field("purchase_order"):
                    nc_count = frappe.db.count(
                        nc_doctype,
                        filters={"purchase_order": ["in", po_names], "docstatus": ["!=", 2]},
                    )
            except Exception:
                nc_count = 0

        # Contract expiry — query the Contract doctype (party_type=Supplier, end_date field)
        contract_status = "none"
        contract_display = "No Contract"
        try:
            if _doctype_exists("Contract") and frappe.has_permission("Contract", "read"):
                contracts = frappe.get_all(
                    "Contract",
                    filters={"party_type": "Supplier", "party_name": s_name, "docstatus": ["!=", 2]},
                    fields=["end_date", "status"],
                    order_by="end_date desc",
                    limit=1,
                )
                if not contracts:
                    # Also try matching by supplier code (name field)
                    contracts = frappe.get_all(
                        "Contract",
                        filters={"party_type": "Supplier", "party_name": s_code, "docstatus": ["!=", 2]},
                        fields=["end_date", "status"],
                        order_by="end_date desc",
                        limit=1,
                    )
                if contracts:
                    end_date_val = contracts[0].get("end_date")
                    if end_date_val:
                        exp_date = frappe.utils.getdate(end_date_val)
                        delta = (exp_date - today_date).days
                        if delta < 0:
                            contract_status = "expired"
                        elif delta <= 30:
                            contract_status = "expiring_soon"
                        else:
                            contract_status = "active"
                        contract_display = str(exp_date)
        except Exception:
            pass

        result.append({
            "name": s_name,
            "supplier_code": s_code,
            "orders": order_count,
            "value": total_val,
            "nc": nc_count,
            "delayed": delayed_count,
            "avg": f"{avg_delay_days} days" if avg_delay_days > 0 else "0 days",
            "contract": contract_display,
            "contract_status": contract_status,
        })

    return result


@frappe.whitelist()
def get_pending_so_details(
    item_code: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
) -> list[dict[str, Any]]:
    """Return live direct and indirect (BOM) pending Sales Order commitments for an item.
    Optionally filtered by delivery_date within from_date..to_date.
    """
    if not item_code or not frappe.has_permission("Sales Order", "read"):
        return []

    result = []

    so_filters: dict[str, Any] = {"item_code": item_code, "docstatus": 1}
    # Apply date range filter on delivery_date of the SO item
    if from_date and to_date:
        so_filters["delivery_date"] = ["between", [from_date, to_date]]
    elif from_date:
        so_filters["delivery_date"] = [">=", from_date]
    elif to_date:
        so_filters["delivery_date"] = ["<=", to_date]

    so_items = frappe.get_all(
        "Sales Order Item",
        filters=so_filters,
        fields=["parent", "qty", "delivered_qty", "delivery_date"],
    )

    for s in so_items:
        rem_qty = flt(s.qty) - flt(s.delivered_qty)
        if rem_qty <= 0:
            continue
        so_doc = frappe.db.get_value("Sales Order", s.parent, ["customer_name", "customer", "delivery_date"], as_dict=True) or {}
        result.append({
            "so": s.parent,
            "cust": so_doc.get("customer_name") or so_doc.get("customer") or "—",
            "qty": rem_qty,
            "due": str(so_doc.get("delivery_date") or s.get("delivery_date") or "—"),
        })

    if _doctype_exists("BOM"):
        bom_parents = frappe.db.sql(
            """
            SELECT b.item AS parent_item, (bi.qty / IFNULL(NULLIF(b.quantity, 0), 1)) AS qty_per_unit
            FROM `tabBOM Item` bi
            JOIN `tabBOM` b ON bi.parent = b.name
            WHERE bi.item_code = %s AND b.docstatus = 1 AND b.is_active = 1
            """,
            (item_code,),
            as_dict=True,
        )

        for bp in bom_parents:
            p_item = bp.get("parent_item")
            ratio = flt(bp.get("qty_per_unit"))
            if not p_item or ratio <= 0:
                continue

            p_filters: dict[str, Any] = {"item_code": p_item, "docstatus": 1}
            if from_date and to_date:
                p_filters["delivery_date"] = ["between", [from_date, to_date]]
            elif from_date:
                p_filters["delivery_date"] = [">=", from_date]
            elif to_date:
                p_filters["delivery_date"] = ["<=", to_date]

            p_so_items = frappe.get_all(
                "Sales Order Item",
                filters=p_filters,
                fields=["parent", "qty", "delivered_qty", "delivery_date"],
            )

            for ps in p_so_items:
                rem_p_qty = flt(ps.qty) - flt(ps.delivered_qty)
                if rem_p_qty <= 0:
                    continue
                needed_component_qty = rem_p_qty * ratio
                so_doc = frappe.db.get_value("Sales Order", ps.parent, ["customer_name", "customer", "delivery_date"], as_dict=True) or {}
                result.append({
                    "so": f"{ps.parent} (via BOM → {p_item})",
                    "cust": so_doc.get("customer_name") or so_doc.get("customer") or "—",
                    "qty": round(needed_component_qty, 2),
                    "due": str(so_doc.get("delivery_date") or ps.get("delivery_date") or "—"),
                })

    return result


@frappe.whitelist()
def get_export_forecast_details(item_code: str | None = None) -> list[dict[str, Any]]:
    """Return Quotation line items (direct + BOM-indirect) contributing to export forecast for an item."""
    if not item_code or not frappe.has_permission("Quotation", "read"):
        return []

    result = []

    # Direct quotation rows for this item
    if _doctype_exists("Quotation Item"):
        q_items = frappe.get_all(
            "Quotation Item",
            filters={"item_code": item_code, "docstatus": 1},
            fields=["parent", "qty", "uom", "rate"],
        )
        for q in q_items:
            quot = frappe.db.get_value(
                "Quotation", q.parent,
                ["customer_name", "party_name", "transaction_date", "status"],
                as_dict=True,
            ) or {}
            result.append({
                "quot": q.parent,
                "party": quot.get("customer_name") or quot.get("party_name") or "—",
                "qty": round(flt(q.qty), 2),
                "uom": q.uom or "",
                "date": str(quot.get("transaction_date") or "—"),
                "via": "",
            })

    # BOM-indirect: find parent items that use this item_code
    if _doctype_exists("BOM"):
        bom_parents = frappe.db.sql(
            """
            SELECT b.item AS parent_item, (bi.qty / IFNULL(NULLIF(b.quantity, 0), 1)) AS qty_per_unit
            FROM `tabBOM Item` bi
            JOIN `tabBOM` b ON bi.parent = b.name
            WHERE bi.item_code = %s AND b.docstatus = 1 AND b.is_active = 1
            """,
            (item_code,),
            as_dict=True,
        )
        for bp in bom_parents:
            p_item = bp.get("parent_item")
            ratio = flt(bp.get("qty_per_unit"))
            if not p_item or ratio <= 0:
                continue
            p_q_items = frappe.get_all(
                "Quotation Item",
                filters={"item_code": p_item, "docstatus": 1},
                fields=["parent", "qty", "uom", "rate"],
            )
            for q in p_q_items:
                needed = flt(q.qty) * ratio
                quot = frappe.db.get_value(
                    "Quotation", q.parent,
                    ["customer_name", "party_name", "transaction_date", "status"],
                    as_dict=True,
                ) or {}
                result.append({
                    "quot": q.parent,
                    "party": quot.get("customer_name") or quot.get("party_name") or "—",
                    "qty": round(needed, 2),
                    "uom": q.uom or "",
                    "date": str(quot.get("transaction_date") or "—"),
                    "via": p_item,
                })

    return result


@frappe.whitelist()
def get_delayed_po_details(supplier: str | None = None) -> list[dict[str, Any]]:
    """Return live delayed Purchase Orders for a specific supplier.
    Delay is calculated as receipt_date - required_date for received POs,
    or today - required_date for open overdue POs.
    """
    if not supplier or not frappe.has_permission("Purchase Order", "read"):
        return []

    pos = frappe.get_all(
        "Purchase Order",
        filters={"supplier": supplier, "docstatus": 1},
        fields=["name", "schedule_date", "transaction_date", "status", "per_received", "grand_total"],
        limit_page_length=20,
    )

    today_date = frappe.utils.getdate(nowdate())

    # Get receipt dates for all POs
    po_names = [p.get("name") for p in pos if p.get("name")]
    receipt_date_by_po: dict[str, Any] = {}
    if po_names and _doctype_exists("Purchase Receipt Item"):
        try:
            receipts = frappe.db.sql(
                """
                SELECT pri.purchase_order AS po_name, MIN(pr.posting_date) AS receipt_date
                FROM `tabPurchase Receipt Item` pri
                JOIN `tabPurchase Receipt` pr ON pri.parent = pr.name
                WHERE pr.docstatus = 1
                  AND pri.purchase_order IN %(po_names)s
                GROUP BY pri.purchase_order
                """,
                {"po_names": po_names},
                as_dict=True,
            )
            for r in receipts:
                receipt_date_by_po[r.get("po_name")] = r.get("receipt_date")
        except Exception:
            pass

    result = []
    for p in pos:
        sched = p.get("schedule_date") or p.get("transaction_date")
        if not sched:
            continue
        sched_date = frappe.utils.getdate(sched)

        receipt_date = receipt_date_by_po.get(p.get("name"))
        delay_days = 0
        received_date_str = "—"

        if receipt_date:
            receipt_dt = frappe.utils.getdate(receipt_date)
            delay_days = max(0, (receipt_dt - sched_date).days)
            received_date_str = str(receipt_date)
            if delay_days == 0:
                continue  # received on time, skip
        else:
            # Not yet received
            if p.get("status") in ("Closed", "On Hold", "Completed"):
                continue
            if flt(p.get("per_received")) >= 100:
                continue
            if sched_date >= today_date:
                continue  # not yet due
            delay_days = max(0, (today_date - sched_date).days)

        po_items = frappe.get_all("Purchase Order Item", filters={"parent": p.name}, fields=["item_name", "qty"], limit=1)
        item_title = po_items[0].get("item_name") if po_items else p.name

        result.append({
            "po": p.name,
            "item": f"{item_title} (Qty: {po_items[0].qty if po_items else 1})",
            "due": str(sched or "—"),
            "received": received_date_str,
            "delay": f"{delay_days} days" if delay_days > 0 else "Overdue",
            "st": p.status or "Overdue",
        })

    return result
