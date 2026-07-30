frappe.ui.form.on('Payment Request', {
    refresh(frm) {
        render_info_dashboard(frm);
        render_related_documents(frm);
        render_item_summary(frm);

    },
    reference_name(frm) {
        render_info_dashboard(frm);
        render_related_documents(frm);
        render_item_summary(frm);

    },
    grand_total(frm) {
        render_info_dashboard(frm);
    },
    payment_date(frm) {
        // Clear the red highlight the moment a value is entered
        if (frm.doc.payment_date) {
            frm.fields_dict.payment_date.$wrapper.removeClass('has-error');
        }
    },
    before_submit(frm) {
        if (!frm.doc.payment_date) {
            frm.set_df_property('payment_date', 'reqd', 1);
            frm.refresh_field('payment_date');
            frm.fields_dict.payment_date.$wrapper.addClass('has-error');
            frm.scroll_to_field('payment_date');
            frappe.validated = false;
            frappe.throw('Payment Date is mandatory before submitting the Payment Request.');
        }
    }
});

// ===== Minimal SVG icon set (replaces emoji everywhere) =====
const PR_ICONS = {
    invoice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
    status: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>',
    po: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h6"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h16v18l-3-2-2 2-3-2-2 2-3-2-3 2z"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 1 21h22z"/><path d="M12 9v5"/><path d="M12 17h.01"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
};

const PR_ICONS_EXTRA = {
    advance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>',
    debit_note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6"/></svg>',
    return: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v1"/></svg>',
    ledger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M3 9h18M9 21V9"/></svg>',
};
Object.assign(PR_ICONS, PR_ICONS_EXTRA);

function render_info_dashboard(frm) {
    const wrapper = frm.fields_dict.info_dashboard_html.$wrapper;

    if (!frm.doc.reference_name || frm.doc.reference_doctype !== "Purchase Invoice") {
        wrapper.html('');
        return;
    }

    frappe.call({
        method: "jasma.jasma.doc_events.payment_request.get_dashboard_data",
        args: {
            reference_doctype: frm.doc.reference_doctype,
            reference_name: frm.doc.reference_name,
            pr_name: frm.doc.name,
            pr_amount: frm.doc.grand_total
        },
        callback(r) {
            if (r.message) {
                wrapper.html(build_dashboard_html(r.message));
            }
        }
    });
}

function build_dashboard_html(d) {
    const fmt = (v) => format_currency(v, frappe.defaults.get_default("currency"));

    const pe_color = {
        "Not Created": "#6b7280",
        "Draft": "#ca8a04",
        "Submitted": "#16a34a",
        "Cancelled": "#dc2626"
    };
    const pe_bg = {
        "Not Created": "rgba(107,114,128,0.10)",
        "Draft": "rgba(202,138,4,0.10)",
        "Submitted": "rgba(22,163,74,0.10)",
        "Cancelled": "rgba(220,38,38,0.10)"
    };

    const card = (label, valueHtml, icon, accent, extraClass = '', extraAttrs = '') => `
        <div class="pr-info-card ${extraClass}" ${extraAttrs}>
            <div class="pr-info-icon" style="background:${accent}1a;color:${accent};">${icon}</div>
            <div class="pr-info-body">
                <div class="pr-info-label">${label}</div>
                <div class="pr-info-value">${valueHtml}</div>
            </div>
        </div>
    `;

    const payment_status_pill = `
        <span class="pr-status-pill" style="background:${pe_bg[d.payment_entry_status] || 'rgba(107,114,128,0.10)'};color:${pe_color[d.payment_entry_status] || '#374151'};">
            ${d.payment_entry_status}
        </span>
    `;

    // --- Card 4: Purchase Receipt Return(s), clickable ---
    const returns = d.purchase_receipt_returns || [];
    const return_value_html = returns.length
        ? returns.map(name => `
            <a class="pr-gl-link" data-doctype="Purchase Receipt" data-name="${frappe.utils.escape_html(name)}">
                ${frappe.utils.escape_html(name)}
            </a>
        `).join('<br>')
        : '<span style="color:#98a2b3;font-weight:500;font-size:15px;">Not Created</span>';

    // --- Card 5: General Ledger, whole card clickable ---
    const fy = d.fiscal_year;
    const fy_label = fy ? fy.name : '—';
    const gl_attrs = fy
        ? `data-company="${frappe.utils.escape_html(d.company || '')}" data-supplier="${frappe.utils.escape_html(d.supplier || '')}" data-from-date="${fy.start_date}" data-to-date="${fy.end_date}"`
        : '';

    return `
        <style>
            .pr-info-dashboard, .pr-info-dashboard * {
                box-sizing: border-box;
            }
            .pr-info-dashboard {
                display: flex !important;
                gap: 14px;
                flex-wrap: nowrap;
                overflow-x: auto;
                margin-bottom: 16px;
            }
            .pr-info-dashboard.pr-info-dashboard-row2,
            .pr-info-dashboard.pr-info-dashboard-row3 {
                margin-bottom: 16px;
            }
            .pr-info-card {
                display: flex;
                align-items: center;
                gap: 14px;
                background: #ffffff !important;
                border: 1px solid #eef0f3 !important;
                border-radius: 14px;
                padding: 16px 20px !important;
                min-width: 180px;
                flex: 1 1 0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                box-shadow: 0 1px 3px rgba(16,24,40,0.04), 0 1px 2px rgba(16,24,40,0.03);
                transition: box-shadow 0.15s ease, transform 0.15s ease;
            }
            .pr-info-card:hover {
                box-shadow: 0 4px 12px rgba(16,24,40,0.08);
                transform: translateY(-1px);
            }
            .pr-info-card.pr-gl-card {
                cursor: pointer;
            }
            .pr-info-icon {
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 11px;
                flex-shrink: 0;
            }
            .pr-info-icon svg {
                width: 19px;
                height: 19px;
            }
            .pr-info-body {
                display: flex;
                flex-direction: column;
                gap: 3px;
                min-width: 0;
            }
            .pr-status-pill {
                display: inline-block;
                width: fit-content;
                padding: 3px 12px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 600;
                letter-spacing: 0.01em;
            }
            .pr-info-label {
                color: #98a2b3 !important;
                font-size: 11px !important;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                margin: 0 !important;
                white-space: nowrap;
            }
            .pr-info-value {
                color: #101828 !important;
                font-size: 20px !important;
                font-weight: 700 !important;
                letter-spacing: -0.01em;
            }
            .pr-gl-link {
                color: #2563eb !important;
                font-size: 15px;
                font-weight: 700;
                text-decoration: none;
                cursor: pointer;
            }
            .pr-gl-link:hover {
                text-decoration: underline;
            }
        </style>
        <div class="pr-info-dashboard">
            ${card("Invoice Value", fmt(d.invoice_value), PR_ICONS.invoice, "#6366f1")}
            ${card("Outstanding", fmt(d.outstanding_value), PR_ICONS.clock, "#f59e0b")}
            ${card("Payment Req.", fmt(d.payment_request_amount), PR_ICONS.card, "#0ea5e9")}
        </div>
        <div class="pr-info-dashboard pr-info-dashboard-row2">
            ${card("Payment Status", payment_status_pill, PR_ICONS.status, "#8b5cf6")}
            ${card("Available Advance", fmt(d.available_advance), PR_ICONS.advance, "#10b981")}
            ${card("Debit Note (Against Inv.)", fmt(d.debit_note_against_invoice), PR_ICONS.debit_note, "#dc2626")}
        </div>
        <div class="pr-info-dashboard pr-info-dashboard-row3">
            ${card("Debit Note (No Ref.)", fmt(d.debit_note_without_reference), PR_ICONS.debit_note, "#ca8a04")}
            ${card("Purchase Receipt Return", return_value_html, PR_ICONS.return, "#f97316")}
            ${card(`General Ledger (${fy_label})`, "View Ledger →", PR_ICONS.ledger, "#0891b2", "pr-gl-card", gl_attrs)}
        </div>
    `;
}

function render_related_documents(frm) {
    const wrapper = frm.fields_dict.related_documents_html.$wrapper;

    if (!frm.doc.reference_name || frm.doc.reference_doctype !== "Purchase Invoice") {
        wrapper.html('');
        return;
    }

    frappe.call({
        method: "jasma.jasma.doc_events.payment_request.get_related_documents",
        args: { payment_request: frm.doc.name },
        callback(r) {
            if (r.message) {
                wrapper.html(build_related_documents_html(r.message));
            }
        }
    });
}

function build_related_documents_html(data) {
    const doctype_icons = {
        "Purchase Order": PR_ICONS.po,
        "Purchase Receipt": PR_ICONS.box,
        "Purchase Invoice": PR_ICONS.receipt,
        "QC Report": PR_ICONS.search,
        "Non - Conformance": PR_ICONS.alert,
        "Payment Entry": PR_ICONS.card,
    };

    const doctype_colors = {
        "Purchase Order": "#6366f1",
        "Purchase Receipt": "#f97316",
        "Purchase Invoice": "#0ea5e9",
        "QC Report": "#8b5cf6",
        "Non - Conformance": "#dc2626",
        "Payment Entry": "#16a34a",
    };

    const sections = Object.entries(data)
        .filter(([_, docs]) => docs && docs.length)
        .map(([doctype, docs]) => {
            const chips = docs.map(name => `
                <a class="pr-doc-chip" data-doctype="${frappe.utils.escape_html(doctype)}" data-name="${frappe.utils.escape_html(name)}">
                    ${frappe.utils.escape_html(name)}
                </a>
            `).join('');

            const icon = doctype_icons[doctype] || PR_ICONS.doc;
            const color = doctype_colors[doctype] || "#667085";

            return `
                <div class="pr-doc-row">
                    <div class="pr-doc-row-label">
                        <span class="pr-doc-icon" style="background:${color}1a;color:${color};">${icon}</span>
                        <span class="pr-doc-row-title">${doctype}</span>
                        ${docs.length > 1 ? `<span class="pr-doc-count">${docs.length}</span>` : ''}
                    </div>
                    <div class="pr-doc-chips">${chips}</div>
                </div>
            `;
        }).join('');

    return `
        <style>
            .pr-related-docs, .pr-related-docs * {
                box-sizing: border-box;
            }
            .pr-related-docs {
                background: #ffffff;
                border: 1px solid #eef0f3;
                padding: 8px 22px;
                border-radius: 14px;
                margin-bottom: 16px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                box-shadow: 0 1px 3px rgba(16,24,40,0.04), 0 1px 2px rgba(16,24,40,0.03);
            }
            .pr-doc-row {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 16px;
                padding: 14px 0;
                border-bottom: 1px solid #f2f4f7;
            }
            .pr-doc-row:last-child {
                border-bottom: none;
            }
            .pr-doc-row-label {
                display: flex;
                align-items: center;
                gap: 10px;
                min-width: 190px;
                flex-shrink: 0;
            }
            .pr-doc-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                border-radius: 9px;
                flex-shrink: 0;
            }
            .pr-doc-icon svg {
                width: 15px;
                height: 15px;
            }
            .pr-doc-row-title {
                color: #344054;
                font-size: 13px;
                font-weight: 600;
            }
            .pr-doc-count {
                background: #f2f4f7;
                color: #475467;
                font-size: 10px;
                font-weight: 700;
                padding: 1px 7px;
                border-radius: 10px;
            }
            .pr-doc-chips {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                flex: 1;
            }
            .pr-doc-chip {
                border: 1px solid #d0e3ff;
                border-radius: 8px;
                padding: 6px 14px;
                font-size: 12.5px;
                font-weight: 600;
                color: #2563eb;
                cursor: pointer;
                text-decoration: none;
                background: #eff6ff;
                transition: all 0.15s ease;
            }
            .pr-doc-chip:hover {
                border-color: #2563eb;
                background: #dbeafe;
                color: #1d4ed8;
                transform: translateY(-1px);
            }
        </style>
        <div class="pr-related-docs">
            ${sections || '<div style="color:#98a2b3;font-size:13px;padding:16px 0;">No related documents found</div>'}
        </div>
    `;
}

// Related-document chips (Purchase Order, Purchase Receipt, etc.)
$(document).on('click', '.pr-doc-chip', function () {
    const doctype = $(this).attr('data-doctype');
    const name = $(this).attr('data-name');
    frappe.set_route('Form', doctype, name);
});

// Purchase Receipt Return link inside the info card
$(document).on('click', '.pr-gl-link', function () {
    const doctype = $(this).attr('data-doctype');
    const name = $(this).attr('data-name');
    frappe.set_route('Form', doctype, name);
});

// Whole "General Ledger" card - routes to the report pre-filtered to
// this supplier/company for the current Fiscal Year
$(document).on('click', '.pr-gl-card', function () {
    const $el = $(this);
    const company = $el.attr('data-company');
    const supplier = $el.attr('data-supplier');
    const from_date = $el.attr('data-from-date');
    const to_date = $el.attr('data-to-date');

    if (!company || !supplier || !from_date || !to_date) {
        frappe.msgprint('Fiscal Year or Supplier details are not available yet.');
        return;
    }

    frappe.route_options = {
        company: company,
        party_type: "Supplier",
        party: [supplier],
        from_date: from_date,
        to_date: to_date,
    };
    frappe.set_route("query-report", "General Ledger");
});


function render_item_summary(frm) {
    const wrapper = frm.fields_dict.item_sumurry_html.$wrapper;

    if (!frm.doc.reference_name || frm.doc.reference_doctype !== "Purchase Invoice") {
        wrapper.html('');
        return;
    }

    frappe.call({
        method: "jasma.jasma.doc_events.payment_request.get_item_wise_summary",
        args: { payment_request: frm.doc.name },
        callback(r) {
            if (r.message) {
                wrapper.html(build_item_summary_html(r.message));
            }
        }
    });
}

function build_item_summary_html(items) {
    const fmt = (v) => format_currency(v, frappe.defaults.get_default("currency"));

    const rows = items.map(d => {
        const received_qty = (d.accepted_qty || 0) + (d.rejected_qty || 0);

        const item_code_cell = `
            <span class="pr-code-chip">${frappe.utils.escape_html(d.item_code)}</span>
            ${d.is_subcontracted && d.fg_item
                ? `<div class="pr-fg-code"><span class="pr-code-chip pr-code-chip-fg">${frappe.utils.escape_html(d.fg_item)}</span></div>`
                : ''}
        `;

        const item_name_cell = `
            ${frappe.utils.escape_html(d.item_name)}
            ${d.is_subcontracted && d.fg_item_name
                ? `<span class="pr-fg-name">(${frappe.utils.escape_html(d.fg_item_name)})</span>`
                : ''}
        `;

        return `
        <tr>
            <td class="pr-item-code" title="${frappe.utils.escape_html(d.item_code)}">
                ${item_code_cell}
            </td>
            <td class="pr-item-name" title="${frappe.utils.escape_html(d.item_name)}">${item_name_cell}</td>
            <td class="pr-num">${d.po_qty}</td>
            <td class="pr-num pr-accrej">
                ${received_qty}
                <span class="pr-accrej-detail">(<span class="pr-qty-accepted">${d.accepted_qty}</span>/<span class="pr-qty-rejected">${d.rejected_qty}</span>)</span>
            </td>
            <td class="pr-num">${d.invoice_qty}</td>
            <td class="pr-num">${fmt(d.po_rate)}</td>
            <td class="pr-num">
                ${fmt(d.pi_rate)}
                ${d.rate_mismatch ? `<span class="pr-rate-warning" title="PI rate differs from PO rate">${PR_ICONS.alert}</span>` : ''}
            </td>
        </tr>
    `;
    }).join('');

    return `
        <style>
            .pr-item-summary-wrap, .pr-item-summary-wrap * {
                box-sizing: border-box;
            }
            .pr-item-summary-wrap {
                margin-bottom: 16px;
                border-radius: 14px;
                overflow: hidden;
                border: 1px solid #eef0f3;
                box-shadow: 0 1px 3px rgba(16,24,40,0.04), 0 1px 2px rgba(16,24,40,0.03);
                background: #ffffff !important;
            }
            .pr-item-summary-table {
                width: 100% !important;
                table-layout: fixed !important;
                border-collapse: separate !important;
                border-spacing: 0 !important;
                font-size: 13px !important;
                background: #ffffff !important;
                margin: 0 !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .pr-item-summary-table col.pr-col-code    { width: 16%; }
            .pr-item-summary-table col.pr-col-name    { width: 27%; }
            .pr-item-summary-table col.pr-col-poqty   { width: 9%; }
            .pr-item-summary-table col.pr-col-accrej  { width: 15%; }
            .pr-item-summary-table col.pr-col-invqty  { width: 10%; }
            .pr-item-summary-table col.pr-col-porate  { width: 10%; }
            .pr-item-summary-table col.pr-col-pirate  { width: 13%; }
            .pr-item-summary-table thead th {
                background: #f9fafb !important;
                color: #667085 !important;
                text-align: left !important;
                font-weight: 600 !important;
                font-size: 11px !important;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                padding: 12px 10px !important;
                border: none !important;
                border-bottom: 1px solid #eef0f3 !important;
            }
            .pr-item-summary-table thead th.pr-num,
            .pr-item-summary-table td.pr-num {
                text-align: right !important;
            }
            .pr-item-summary-table tbody td {
                padding: 10px 10px !important;
                color: #344054 !important;
                border: none !important;
                border-bottom: 1px solid #f2f4f7 !important;
                background: transparent !important;
                vertical-align: middle;
            }
            .pr-item-summary-table td.pr-item-name {
                white-space: normal;
                word-break: break-word;
                padding-left: 6px !important;
                line-height: 1.35;
            }
            .pr-item-summary-table td.pr-item-code {
                white-space: normal;
                word-break: break-word;
                padding-right: 6px !important;
            }
            .pr-fg-code {
                margin-top: 4px;
            }
            .pr-fg-name {
                margin-left: 4px;
                font-size: 11.5px;
                color: #667085;
            }
            .pr-item-summary-table tbody tr {
                background: #ffffff !important;
                transition: background 0.15s ease;
            }
            .pr-item-summary-table tbody tr:nth-child(even) {
                background: #fbfbfc !important;
            }
            .pr-item-summary-table tbody tr:hover {
                background: #f5f8ff !important;
            }
            .pr-item-summary-table tbody tr:last-child td {
                border-bottom: none !important;
            }
            .pr-code-chip {
                display: inline-block;
                color: #2563eb !important;
                background: #eff6ff;
                border: 1px solid #d0e3ff;
                padding: 3px 8px;
                border-radius: 6px;
                font-family: 'SFMono-Regular', Consolas, monospace;
                font-size: 11.5px;
                line-height: 1.4;
            }
            .pr-code-chip-fg {
                color: #7c3aed !important;
                background: #f5f3ff;
                border: 1px solid #ddd6fe;
            }
            .pr-item-name {
                color: #101828 !important;
                font-weight: 500;
            }
            .pr-accrej {
                font-variant-numeric: tabular-nums;
                font-weight: 600;
                white-space: nowrap;
            }
            .pr-accrej-detail {
                font-size: 11px;
                font-weight: 500;
                color: #98a2b3;
                margin-left: 3px;
            }
            .pr-accrej-detail .pr-qty-accepted,
            .pr-accrej-detail .pr-qty-rejected {
                font-weight: 600;
            }
            .pr-qty-accepted {
                color: #16a34a !important;
            }
            .pr-qty-rejected {
                color: #dc2626 !important;
            }
            .pr-rate-warning {
                display: inline-flex;
                vertical-align: middle;
                color: #ca8a04 !important;
                margin-left: 6px;
            }
            .pr-rate-warning svg {
                width: 13px;
                height: 13px;
            }
        </style>
        <div class="pr-item-summary-wrap">
            <table class="pr-item-summary-table">
                <colgroup>
                    <col class="pr-col-code">
                    <col class="pr-col-name">
                    <col class="pr-col-poqty">
                    <col class="pr-col-accrej">
                    <col class="pr-col-invqty">
                    <col class="pr-col-porate">
                    <col class="pr-col-pirate">
                </colgroup>
                <thead>
                    <tr>
                        <th>Item Code</th>
                        <th>Item Name</th>
                        <th class="pr-num">PO Qty</th>
                        <th class="pr-num">Recv Qty (A/R)</th>
                        <th class="pr-num">Invoice Qty</th>
                        <th class="pr-num">PO Rate</th>
                        <th class="pr-num">PI Rate</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows || `<tr><td colspan="7" style="text-align:center;color:#98a2b3;padding:18px;">No items found</td></tr>`}
                </tbody>
            </table>
        </div>
    `;
}