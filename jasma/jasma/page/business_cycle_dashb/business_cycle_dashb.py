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

    # Payment Entry is shared by all three cycles. Keep receipts from customers
    # in Sales and payments to suppliers in Purchase/Subcontracting.
    if doctype == "Payment Entry" and _has_field(meta, "party_type"):
        filters["party_type"] = "Customer" if cycle == "sales" else "Supplier"

    # Only the subcontracting-specific records should appear in the shared
    # Purchase Order and Stock Entry stages.
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
    }


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

    # Fill the remainder with visible scalar fields so custom MEL documents
    # (TRS and Transformer Output Sheet) still have a useful current-state
    # preview without hard-coding every custom field.
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

    # Direct Link fields on the selected document.
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

    # Backlinks from other cycle documents to the selected document.
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
