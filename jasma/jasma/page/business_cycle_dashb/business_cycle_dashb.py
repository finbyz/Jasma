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
        ["item_code", "item_name", "qty", "received_qty", "uom", "schedule_date", "rate","fg_item"],
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
            "fg_item": row.get("fg_item") or "",
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
                "jpc": r.name,
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
                "jpc": r.name,
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
                "jpc": r.name,
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
        filters = {
            "docstatus": 1,
            "status": ["not in", ["Closed", "Completed"]],
            "per_received": ["<", 100],
        }
        if company:
            filters["company"] = company

        po_meta = frappe.get_meta("Purchase Order")
        po_fields = ["name", "transaction_date", "supplier", "supplier_name", "owner", "status", "per_received"]
        if po_meta.has_field("is_subcontracted"):
            po_fields.append("is_subcontracted")

        records = frappe.get_list(
            "Purchase Order",
            filters=filters,
            fields=po_fields,
            order_by="modified desc",
        )
        card_recs = [
            {
                "ao": r.name,
                "date": str(r.transaction_date or ""),
                "item": r.supplier_name or r.supplier or r.name,
                "jpc": r.name,
                "status": r.status or "To Receive",
                "who": r.owner or "—",
                "doctype": "Purchase Order",
                "_is_subcontracted": cint(r.get("is_subcontracted")),
            }
            for r in records
        ]

        # Attach child items (fg_item comes from Purchase Order Item child table)
        items_map = _fetch_items_for_docs("Purchase Order", [r.name for r in records])

        # Identify which item codes are Service (non-stock) items
        all_item_codes = {
            item.get("item_code")
            for items in items_map.values()
            for item in items
            if item.get("item_code")
        }
        service_item_codes: set[str] = set()
        if all_item_codes and _doctype_exists("Item"):
            item_rows = frappe.get_all(
                "Item",
                filters={"name": ["in", list(all_item_codes)]},
                fields=["name", "is_stock_item"],
            )
            service_item_codes = {
                row.name for row in item_rows if not cint(row.get("is_stock_item"))
            }

        # Resolve item_name for every fg_item referenced by a service item,
        # in one batch query (avoids N+1 lookups).
        fg_item_codes = {
            item.get("fg_item")
            for items in items_map.values()
            for item in items
            if item.get("item_code") in service_item_codes and item.get("fg_item")
        }
        fg_item_name_by_code: dict[str, str] = {}
        if fg_item_codes and _doctype_exists("Item"):
            fg_rows = frappe.get_all(
                "Item",
                filters={"name": ["in", list(fg_item_codes)]},
                fields=["name", "item_name"],
            )
            fg_item_name_by_code = {
                row.name: row.item_name or row.name for row in fg_rows
            }

        # Rules:
        #   Subcontracted PO:
        #       - Keep the PO, show all items.
        #       - Service items display fg_item's item_code AND fg_item's item_name
        #         (looked up from the Item master), instead of the service item's own values.
        #   Not subcontracted PO:
        #       - If it has at least one Stock item -> keep the PO,
        #         but drop Service items entirely (not shown at all).
        #       - If it has ONLY Service items (no stock item) -> exclude
        #         the entire PO from the card.
        filtered_card_recs = []
        for rec in card_recs:
            is_subcontracted = rec.pop("_is_subcontracted", 0)
            doc_items = items_map.get(rec["ao"], [])

            has_stock_item = any(
                item.get("item_code") and item.get("item_code") not in service_item_codes
                for item in doc_items
            )

            if is_subcontracted:
                display_items = []
                for item in doc_items:
                    item = dict(item)  # avoid mutating shared items_map cache
                    if item.get("item_code") in service_item_codes:
                        fg_code = item.get("fg_item")
                        if fg_code:
                            item["item_code"] = fg_code
                            item["item_name"] = fg_item_name_by_code.get(fg_code, fg_code)
                    display_items.append(item)
            else:
                if not has_stock_item:
                    continue  # only service items, no stock item -> drop entire PO
                display_items = [
                    item for item in doc_items
                    if item.get("item_code") not in service_item_codes
                ]

            rec["doc_items"] = display_items
            filtered_card_recs.append(rec)
        card_recs = filtered_card_recs

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
                "jpc": r.name,
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
                "jpc": r.jasma_part_code or r.name,
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
            order_by="modified desc",
        )

        overdue_recs = []
        for r in records:
            if r.get("status") in ("Closed", "On Hold", "Delivered", "Completed"):
                continue
            if flt(r.get("per_received")) >= 100:
                continue

            sched = r.get("schedule_date")
            if not sched:
                continue
            sched_date = frappe.utils.getdate(sched)

            if sched_date <= today_date:  # inclusive — matches List View's "<=" filter
                overdue_recs.append({
                    "ao": r.name,
                    "date": str(r.transaction_date or ""),
                    "item": r.supplier_name or r.supplier or r.name,
                    "jpc": r.name,
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
    """Return component_item_code -> list of {parent_item, qty_per_unit} from Default+Active BOMs.

    A BOM's OWN is_default flag (the "Default" badge on the BOM form) is the authoritative
    signal for which BOM to explode — NOT Item.default_bom. The two are supposed to stay in
    sync (Frappe updates Item.default_bom when a BOM's is_default checkbox is set), but they
    can drift, e.g. after manually re-defaulting a BOM, leaving Item.default_bom pointing at
    an older BOM while the BOM doc itself clearly shows "Default"/"Active" on screen. Filtering
    on b.is_default = 1 directly always matches what's actually visible to the user.

    Primary source is BOM Explosion Item (pre-flattened, recursive), so nested sub-assemblies
    are included. Explosion Item only regenerates when the BOM is saved, so as a fallback, any
    Default+Active BOM with zero Explosion Item rows is read straight from BOM Item (the
    Components table) instead.
    """
    if not _doctype_exists("BOM"):
        return {}

    # Primary: pre-flattened explosion table.
    bom_items = frappe.db.sql(
        """
        SELECT
            b.name AS bom_name,
            b.item AS parent_item,
            bei.item_code AS component_item,
            SUM(bei.qty_consumed_per_unit) AS qty_per_unit
        FROM `tabBOM Explosion Item` bei
        JOIN `tabBOM` b ON bei.parent = b.name
        WHERE b.docstatus = 1 AND b.is_active = 1 AND b.is_default = 1
        GROUP BY b.name, b.item, bei.item_code
        """,
        as_dict=True,
    )
    boms_with_explosion = {row.get("bom_name") for row in bom_items}

    # Fallback: Default+Active BOMs with no Explosion Item rows at all
    # (stale/never-regenerated explosion table).
    default_active_boms = frappe.db.sql(
        """
        SELECT b.name AS bom_name, b.item AS parent_item
        FROM `tabBOM` b
        WHERE b.docstatus = 1 AND b.is_active = 1 AND b.is_default = 1
        """,
        as_dict=True,
    )
    missing_boms = [
        row for row in default_active_boms
        if row.get("bom_name") not in boms_with_explosion
    ]

    fallback_items: list[dict[str, Any]] = []
    if missing_boms:
        missing_names = [row.get("bom_name") for row in missing_boms]
        parent_item_by_bom = {row.get("bom_name"): row.get("parent_item") for row in missing_boms}

        raw_fallback = frappe.db.sql(
            """
            SELECT
                bi.parent AS bom_name,
                bi.item_code AS component_item,
                SUM(bi.qty / IFNULL(NULLIF(b.quantity, 0), 1)) AS qty_per_unit
            FROM `tabBOM Item` bi
            JOIN `tabBOM` b ON bi.parent = b.name
            WHERE bi.parent IN %(bom_names)s
            GROUP BY bi.parent, bi.item_code
            """,
            {"bom_names": tuple(missing_names)},
            as_dict=True,
        )
        for row in raw_fallback:
            row["parent_item"] = parent_item_by_bom.get(row.get("bom_name"))
            fallback_items.append(row)

    comp_map: dict[str, list[dict[str, Any]]] = {}
    for row in bom_items + fallback_items:
        comp = row.get("component_item")
        parent_item = row.get("parent_item")
        if not comp or not parent_item:
            continue
        comp_map.setdefault(comp, []).append({
            "parent_item": parent_item,
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
            """,
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
def get_stock_overview(
    search: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
) -> list[dict[str, Any]]:
    """Return stock overview with Bin valuation, Sales Order + BOM commitments, Quotation + BOM forecasts,
    and overdue PO qty (not yet received past required date).

    Export Commitment (Sales Order pending qty) is filtered by delivery date when
    from_date/to_date are supplied — same delivery_date-based filter used in
    get_pending_so_details, so the badge total shown here always matches the
    drill-down modal's total for the same date range.
    """
    if not frappe.has_permission("Item", "read"):
        return []

    filters = {}
    if search:
        filters["item_code"] = ["like", f"%{search}%"]

    items = frappe.get_list(
        "Item",
        filters={
            **filters,
            "is_jpc_item": 1,
        },
        fields=["name", "item_code", "item_name", "valuation_rate", "standard_rate"],
        limit_page_length=500,
        order_by="modified desc",
    )

    # ── Sales Order pending qty (Export Commitment) — date filter on delivery_date ─
    # Uses the same "delivery_date on Sales Order Item, falling back to the parent
    # Sales Order's delivery_date" rule as get_pending_so_details, so the badge total
    # here and the modal's total always agree for the same from_date/to_date.
    so_pending_by_item: dict[str, float] = {}
    if _doctype_exists("Sales Order Item"):
        date_conditions: list[str] = []
        date_params: dict[str, Any] = {}
        if from_date and to_date:
            date_conditions.append(
                "IFNULL(soi.delivery_date, so.delivery_date) BETWEEN %(from_date)s AND %(to_date)s"
            )
            date_params["from_date"] = from_date
            date_params["to_date"] = to_date
        elif from_date:
            date_conditions.append("IFNULL(soi.delivery_date, so.delivery_date) >= %(from_date)s")
            date_params["from_date"] = from_date
        elif to_date:
            date_conditions.append("IFNULL(soi.delivery_date, so.delivery_date) <= %(to_date)s")
            date_params["to_date"] = to_date
        date_sql = (" AND " + " AND ".join(date_conditions)) if date_conditions else ""

        so_rows = frappe.db.sql(
            f"""
            SELECT soi.item_code AS item_code, SUM(soi.qty - soi.delivered_qty) AS pending_qty
            FROM `tabSales Order Item` soi
            JOIN `tabSales Order` so ON so.name = soi.parent
            WHERE soi.docstatus = 1
              AND soi.qty > soi.delivered_qty
              {date_sql}
            GROUP BY soi.item_code
            """,
            date_params,
            as_dict=True,
        )
        for r in so_rows:
            if r.get("item_code"):
                so_pending_by_item[r.get("item_code")] = flt(r.get("pending_qty"))

        # ── Quotation qty (forecast) ──────────────────────────────────────────
    # NOTE: `status` and `transaction_date` live on the PARENT Quotation
    # doctype, not on the Quotation Item child table - querying them
    # directly off `tabQuotation Item` throws
    # "Unknown column 'status' in 'WHERE'" (MySQL error 1054). Join to
    # `tabQuotation` to reach them. `docstatus` is fine to filter on the
    # child table directly since Frappe copies it down from the parent.
    #
    # Only the portion of a Quotation Item NOT yet converted to a Sales Order
    # counts as "forecast" — qi.ordered_qty is Frappe's standard field that
    # tracks how much of a Quotation line has already become a Sales Order.
    # A line fully converted (qty - ordered_qty <= 0) is dropped entirely;
    # a partially converted line (e.g. qty=5, ordered_qty=2) contributes
    # only the remaining 3, not the original 5.
    quot_by_item: dict[str, float] = {}
    if _doctype_exists("Quotation Item"):
        conditions = [
            "qi.docstatus = 1",
            'qtn.status != "Lost"',
            "qi.qty > IFNULL(qi.ordered_qty, 0)",
        ]
        params: dict[str, Any] = {}
        if from_date and to_date:
            conditions.append("qtn.transaction_date BETWEEN %(from_date)s AND %(to_date)s")
            params["from_date"] = from_date
            params["to_date"] = to_date
        elif from_date:
            conditions.append("qtn.transaction_date >= %(from_date)s")
            params["from_date"] = from_date
        elif to_date:
            conditions.append("qtn.transaction_date <= %(to_date)s")
            params["to_date"] = to_date

        q_rows = frappe.db.sql(
            f"""
            SELECT qi.item_code, SUM(qi.qty - IFNULL(qi.ordered_qty, 0)) AS forecast_qty
            FROM `tabQuotation Item` qi
            INNER JOIN `tabQuotation` qtn ON qtn.name = qi.parent
            WHERE {" AND ".join(conditions)}
            GROUP BY qi.item_code
            """,
            params,
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

        total_stock = round(sum(flt(b.get("actual_qty")) for b in bin_records), 2)

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
            "jpc": code if len(code) >= 4 else code,
            "rate": val_rate,
            "stock": total_stock,
            "pending_po_qty": pending_po_qty,   # overdue PO qty
            # "pending": round(export_commitment, 2),  # kept for backward compat
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
def get_supplier_performance(
    search: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
) -> list[dict[str, Any]]:
    """Return permission-aware supplier performance analysis with:
    - NC count filtered per supplier
    - PO delay based on receipt date vs required date (for received POs)
      or today vs required date (for open overdue POs)
    - Contract expiry color status
    Only includes suppliers whose Supplier Group is "Product Supplier".
    Total Orders, Total Value, NC Count, and PO Delayed are filtered to
    Purchase Orders whose transaction_date falls within from_date..to_date
    when provided.
    """
    if not frappe.has_permission("Supplier", "read"):
        return []

    filters = {"supplier_group": "Product Supplier"}
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

        po_filters: dict[str, Any] = {"supplier": s_code, "docstatus": 1}
        if from_date and to_date:
            po_filters["transaction_date"] = ["between", [from_date, to_date]]
        elif from_date:
            po_filters["transaction_date"] = [">=", from_date]
        elif to_date:
            po_filters["transaction_date"] = ["<=", to_date]

        pos = frappe.get_all(
            "Purchase Order",
            filters=po_filters,
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
                receipt_dt = frappe.utils.getdate(receipt_date)
                diff = (receipt_dt - sched_date).days
                if diff > 0:
                    delayed_count += 1
                    total_delay_days += diff
            else:
                if sched_date < today_date and flt(p.get("per_received")) < 100:
                    if p.get("status") not in ("Closed", "On Hold", "Completed"):
                        diff = (today_date - sched_date).days
                        if diff > 0:
                            delayed_count += 1
                            total_delay_days += diff

        avg_delay_days = round(total_delay_days / delayed_count, 1) if delayed_count else 0.0

        # NC count — linked via reference_name (Purchase Receipt) or reference_type (Purchase Order)
        # Restricted to the same date-filtered po_names / GRNs so NC Count matches the date range too.
        nc_count = 0
        if nc_doctype and frappe.has_permission(nc_doctype, "read"):
            try:
                nc_meta = frappe.get_meta(nc_doctype)
                if nc_has_supplier:
                    nc_filters: dict[str, Any] = {"supplier": s_code, "docstatus": ["!=", 2]}
                    if from_date and to_date:
                        nc_filters["creation"] = ["between", [from_date, to_date]]
                    elif from_date:
                        nc_filters["creation"] = [">=", from_date]
                    elif to_date:
                        nc_filters["creation"] = ["<=", to_date]
                    nc_count = frappe.db.count(nc_doctype, filters=nc_filters)
                elif nc_meta.has_field("reference_name") and nc_meta.has_field("reference_type"):
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

                    if grn_names:
                        nc_count += frappe.db.count(
                            nc_doctype,
                            filters={
                                "reference_type": "Purchase Receipt",
                                "reference_name": ["in", grn_names],
                                "docstatus": ["!=", 2],
                            },
                        )

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
    """Return direct and indirect (BOM) pending Sales Order commitments for an item,
    filtered by delivery date when from_date/to_date are supplied.

    Date filter is applied on the Sales Order's delivery_date, falling back to the
    Sales Order Item row's own delivery_date when the parent's is blank. Both the
    direct rows and the BOM-indirect rows respect the same date range, so the total
    shown in the modal always matches the filtered list beneath it.

    Indirect (via-BOM) rows are matched using the BOM document's OWN is_default /
    is_active flags — NOT Item.default_bom, which can drift out of sync with what's
    actually shown as "Default"/"Active" on the BOM form. Explosion Item (recursive,
    pre-flattened) is the primary source; any Default+Active BOM with zero Explosion
    Item rows (stale explosion table) falls back to reading BOM Item directly.
    """
    if not item_code or not frappe.has_permission("Sales Order", "read"):
        return []

    result = []

    # ── Build shared date filter clause ───────────────────────────────────
    date_conditions: list[str] = []
    date_params: dict[str, Any] = {}
    if from_date and to_date:
        date_conditions.append(
            "IFNULL(soi.delivery_date, so.delivery_date) BETWEEN %(from_date)s AND %(to_date)s"
        )
        date_params["from_date"] = from_date
        date_params["to_date"] = to_date
    elif from_date:
        date_conditions.append("IFNULL(soi.delivery_date, so.delivery_date) >= %(from_date)s")
        date_params["from_date"] = from_date
    elif to_date:
        date_conditions.append("IFNULL(soi.delivery_date, so.delivery_date) <= %(to_date)s")
        date_params["to_date"] = to_date
    date_sql = (" AND " + " AND ".join(date_conditions)) if date_conditions else ""

    # ── Direct SO rows for this item ──────────────────────────────────────
    so_rows = frappe.db.sql(
        f"""
        SELECT
            soi.parent AS so_name,
            soi.qty AS qty,
            soi.delivered_qty AS delivered_qty,
            soi.delivery_date AS item_delivery_date,
            so.customer_name AS customer_name,
            so.customer AS customer,
            so.delivery_date AS so_delivery_date,
            so.project AS project
        FROM `tabSales Order Item` soi
        JOIN `tabSales Order` so ON so.name = soi.parent
        WHERE soi.item_code = %(item_code)s
          AND soi.docstatus = 1
          {date_sql}
        """,
        {"item_code": item_code, **date_params},
        as_dict=True,
    )

    for s in so_rows:
        rem_qty = flt(s.get("qty")) - flt(s.get("delivered_qty"))
        if rem_qty <= 0:
            continue
        result.append({
            "so": s.get("so_name"),
            "cust": s.get("customer_name") or s.get("customer") or "—",
            "qty": rem_qty,
            "due": str(s.get("so_delivery_date") or s.get("item_delivery_date") or "—"),
            "project": s.get("project") or "—",
        })

    # ── Indirect (via-BOM) rows ────────────────────────────────────────────
    if _doctype_exists("BOM"):
        # Primary: pre-flattened Explosion Item (handles nested sub-assemblies).
        bom_parents = frappe.db.sql(
            """
            SELECT
                b.name AS bom_name,
                b.item AS parent_item,
                SUM(bei.qty_consumed_per_unit) AS qty_per_unit
            FROM `tabBOM Explosion Item` bei
            JOIN `tabBOM` b ON bei.parent = b.name
            WHERE bei.item_code = %s
              AND b.docstatus = 1
              AND b.is_active = 1
              AND b.is_default = 1
            GROUP BY b.name, b.item
            """,
            (item_code,),
            as_dict=True,
        )
        boms_with_explosion = {row.get("bom_name") for row in bom_parents}

        # Fallback: Default+Active BOMs where this item sits directly in BOM Item
        # (Components tab) but Explosion Item has no rows for that BOM at all.
        candidate_boms = frappe.db.sql(
            """
            SELECT DISTINCT b.name AS bom_name, b.item AS parent_item
            FROM `tabBOM Item` bi
            JOIN `tabBOM` b ON bi.parent = b.name
            WHERE bi.item_code = %s
              AND b.docstatus = 1
              AND b.is_active = 1
              AND b.is_default = 1
            """,
            (item_code,),
            as_dict=True,
        )
        missing_boms = [
            row for row in candidate_boms
            if row.get("bom_name") not in boms_with_explosion
        ]

        if missing_boms:
            missing_names = [row.get("bom_name") for row in missing_boms]
            fallback_parents = frappe.db.sql(
                """
                SELECT
                    b.name AS bom_name,
                    b.item AS parent_item,
                    SUM(bi.qty / IFNULL(NULLIF(b.quantity, 0), 1)) AS qty_per_unit
                FROM `tabBOM Item` bi
                JOIN `tabBOM` b ON bi.parent = b.name
                WHERE bi.parent IN %(bom_names)s
                  AND bi.item_code = %(item_code)s
                GROUP BY b.name, b.item
                """,
                {"bom_names": tuple(missing_names), "item_code": item_code},
                as_dict=True,
            )
            bom_parents = bom_parents + fallback_parents

        # Resolve parent item display names in one batch query.
        parent_codes = [bp.get("parent_item") for bp in bom_parents if bp.get("parent_item")]
        parent_name_by_code: dict[str, str] = {}
        if parent_codes and _doctype_exists("Item"):
            parent_rows = frappe.get_all(
                "Item",
                filters={"name": ["in", parent_codes]},
                fields=["name", "item_name"],
            )
            parent_name_by_code = {row.name: row.item_name or row.name for row in parent_rows}

        for bp in bom_parents:
            p_item = bp.get("parent_item")
            ratio = flt(bp.get("qty_per_unit"))
            if not p_item or ratio <= 0:
                continue
            p_label = parent_name_by_code.get(p_item, p_item)

            p_so_rows = frappe.db.sql(
                f"""
                SELECT
                    soi.parent AS so_name,
                    soi.qty AS qty,
                    soi.delivered_qty AS delivered_qty,
                    soi.delivery_date AS item_delivery_date,
                    so.customer_name AS customer_name,
                    so.customer AS customer,
                    so.delivery_date AS so_delivery_date,
                    so.project AS project
                FROM `tabSales Order Item` soi
                JOIN `tabSales Order` so ON so.name = soi.parent
                WHERE soi.item_code = %(item_code)s
                  AND soi.docstatus = 1
                  {date_sql}
                """,
                {"item_code": p_item, **date_params},
                as_dict=True,
            )

            for ps in p_so_rows:
                rem_p_qty = flt(ps.get("qty")) - flt(ps.get("delivered_qty"))
                if rem_p_qty <= 0:
                    continue
                needed_component_qty = rem_p_qty * ratio
                result.append({
                    "so": f"{ps.get('so_name')} (via BOM → {p_label})",
                    "cust": ps.get("customer_name") or ps.get("customer") or "—",
                    "qty": round(needed_component_qty, 2),
                    "due": str(ps.get("so_delivery_date") or ps.get("item_delivery_date") or "—"),
                    "project": ps.get("project") or "—",
                })

    return result


@frappe.whitelist()
def get_delayed_po_details(supplier: str | None = None) -> list[dict[str, Any]]:
    """Return per-PO delayed order details for a supplier (for the drawer)."""
    if not supplier or not frappe.has_permission("Purchase Order", "read"):
        return []

    today_date = frappe.utils.getdate(nowdate())

    pos = frappe.get_all(
        "Purchase Order",
        filters={"supplier": supplier, "docstatus": 1},
        fields=["name", "transaction_date", "schedule_date", "status", "per_received"],
    )
    po_names = [p.get("name") for p in pos if p.get("name")]
    if not po_names:
        return []

    # Item name per PO (first item, for display) — batch fetched
    item_name_by_po: dict[str, str] = {}
    if _doctype_exists("Purchase Order Item"):
        item_rows = frappe.get_all(
            "Purchase Order Item",
            filters={"parent": ["in", po_names]},
            fields=["parent", "item_code", "item_name", "idx"],
            order_by="parent, idx",
        )
        for row in item_rows:
            parent = row.get("parent")
            if parent not in item_name_by_po:
                item_name_by_po[parent] = row.get("item_name") or row.get("item_code") or "—"

    # Receipt date map (earliest receipt per PO)
    receipt_date_by_po: dict[str, Any] = {}
    if _doctype_exists("Purchase Receipt Item"):
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
        received_display = "—"

        if receipt_date:
            receipt_dt = frappe.utils.getdate(receipt_date)
            delay_days = (receipt_dt - sched_date).days
            received_display = str(receipt_dt)
        else:
            if sched_date < today_date and flt(p.get("per_received")) < 100:
                if p.get("status") not in ("Closed", "On Hold", "Completed"):
                    delay_days = (today_date - sched_date).days

        if delay_days > 0:
            result.append({
                "po": p.get("name"),
                "item": item_name_by_po.get(p.get("name"), "—"),
                "due": str(sched_date),
                "received": received_display,
                "delay": f"{delay_days} days",
                "st": p.get("status") or "—",
            })

    result.sort(key=lambda r: int(r["delay"].split(" ")[0]), reverse=True)
    return result


@frappe.whitelist()
def get_export_forecast_details(
    item_code: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
) -> list[dict[str, Any]]:
    """Return Quotation line items (direct + BOM-indirect) contributing to export forecast for an item.

    Only the portion of each Quotation Item NOT yet converted to a Sales Order is shown
    (qty - ordered_qty). Date filter is applied on the Quotation's transaction_date — the
    same field and rule used in get_stock_overview's forecast total — so the badge total
    and this drill-down list always agree for the same from_date/to_date.
    """
    if not item_code or not frappe.has_permission("Quotation", "read"):
        return []

    result = []

    # ── Build shared date filter clause (on Quotation.transaction_date) ────
    date_conditions: list[str] = []
    date_params: dict[str, Any] = {}
    if from_date and to_date:
        date_conditions.append("qtn.transaction_date BETWEEN %(from_date)s AND %(to_date)s")
        date_params["from_date"] = from_date
        date_params["to_date"] = to_date
    elif from_date:
        date_conditions.append("qtn.transaction_date >= %(from_date)s")
        date_params["from_date"] = from_date
    elif to_date:
        date_conditions.append("qtn.transaction_date <= %(to_date)s")
        date_params["to_date"] = to_date
    date_sql = (" AND " + " AND ".join(date_conditions)) if date_conditions else ""

    # Direct quotation rows for this item
    if _doctype_exists("Quotation Item"):
        q_rows = frappe.db.sql(
            f"""
            SELECT
                qi.parent AS quot_name,
                qi.qty AS qty,
                qi.ordered_qty AS ordered_qty,
                qi.uom AS uom,
                qtn.customer_name AS customer_name,
                qtn.party_name AS party_name,
                qtn.transaction_date AS transaction_date
            FROM `tabQuotation Item` qi
            JOIN `tabQuotation` qtn ON qtn.name = qi.parent
            WHERE qi.item_code = %(item_code)s
              AND qi.docstatus = 1
              AND qtn.status != "Lost"
              {date_sql}
            """,
            {"item_code": item_code, **date_params},
            as_dict=True,
        )
        for q in q_rows:
            rem_qty = flt(q.get("qty")) - flt(q.get("ordered_qty"))
            if rem_qty <= 0:
                continue
            result.append({
                "quot": q.get("quot_name"),
                "party": q.get("customer_name") or q.get("party_name") or "—",
                "qty": round(rem_qty, 2),
                "uom": q.get("uom") or "",
                "date": str(q.get("transaction_date") or "—"),
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

            p_q_rows = frappe.db.sql(
                f"""
                SELECT
                    qi.parent AS quot_name,
                    qi.qty AS qty,
                    qi.ordered_qty AS ordered_qty,
                    qi.uom AS uom,
                    qtn.customer_name AS customer_name,
                    qtn.party_name AS party_name,
                    qtn.transaction_date AS transaction_date
                FROM `tabQuotation Item` qi
                JOIN `tabQuotation` qtn ON qtn.name = qi.parent
                WHERE qi.item_code = %(item_code)s
                  AND qi.docstatus = 1
                  AND qtn.status != "Lost"
                  {date_sql}
                """,
                {"item_code": p_item, **date_params},
                as_dict=True,
            )
            for q in p_q_rows:
                rem_p_qty = flt(q.get("qty")) - flt(q.get("ordered_qty"))
                if rem_p_qty <= 0:
                    continue
                needed = rem_p_qty * ratio
                result.append({
                    "quot": q.get("quot_name"),
                    "party": q.get("customer_name") or q.get("party_name") or "—",
                    "qty": round(needed, 2),
                    "uom": q.get("uom") or "",
                    "date": str(q.get("transaction_date") or "—"),
                    "via": p_item,
                })

    return result