// Client Script → Doctype: Expense Claim → Apply on: Form View
// Renders a live Employee Advance summary inside the "employee_advance_html" field.
// Only includes advances that are actually listed in the Expense Claim's
// "Advances" child table (fieldname: advances, child doctype: Expense Claim Advance,
// which links to Employee Advance via the "employee_advance" field).

frappe.ui.form.on('Expense Claim', {
    refresh: function (frm) {
        render_employee_advance_dashboard(frm);
    },
    employee: function (frm) {
        render_employee_advance_dashboard(frm);
    },
    advances_on_form_rendered: function (frm) {
        // fires when the Advances child table grid re-renders (row add/remove/edit)
        render_employee_advance_dashboard(frm);
    }
});

// Also refresh whenever a row in the Advances child table changes
frappe.ui.form.on('Expense Claim Advance', {
    employee_advance: function (frm) {
        render_employee_advance_dashboard(frm);
    },
    advances_remove: function (frm) {
        render_employee_advance_dashboard(frm);
    }
});

function render_employee_advance_dashboard(frm) {
    const wrapper = frm.fields_dict.employee_advance_html.$wrapper;
    wrapper.empty();

    if (!frm.doc.employee) {
        wrapper.html(`<div class="text-muted" style="padding:12px;">
            Select an Employee to view advance details.
        </div>`);
        return;
    }

    // Pull the Employee Advance names referenced in the Advances child table only
    const advance_names = (frm.doc.advances || [])
        .map(row => row.employee_advance)
        .filter(name => !!name);

    if (!advance_names.length) {
        wrapper.html(`<div class="text-muted" style="padding:16px;text-align:center;">
            No rows in the Advances table. Add an advance to this Expense Claim to see details here.
        </div>`);
        return;
    }

    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Employee Advance',
            filters: {
                employee: frm.doc.employee,
                docstatus: 1,
                name: ['in', advance_names]
            },
            fields: [
                'name',
                'employee',
                'employee_name',
                'advance_amount',
                'pending_amount',
                'claimed_amount',
                'balance_amount'
            ],
            order_by: 'posting_date desc'
        },
        callback: function (r) {
            const rows = r.message || [];
            wrapper.html(build_table_html(rows));
        }
    });
}

function build_table_html(rows) {
    if (!rows.length) {
        return `<div class="text-muted" style="padding:16px;text-align:center;">
            No matching Employee Advance records found for the advances listed on this claim.
        </div>`;
    }

    let total_advance = 0, total_pending = 0, total_claimed = 0, total_balance = 0;

    const row_html = rows.map(d => {
        total_advance += flt(d.advance_amount);
        total_pending += flt(d.pending_amount);
        total_claimed += flt(d.claimed_amount);
        total_balance += flt(d.balance_amount);

        const balance_class = flt(d.balance_amount) > 0 ? 'balance-due' : 'balance-ok';

        return `
            <tr>
                <td><a href="/app/employee-advance/${d.name}" target="_blank" class="adv-link">${d.name}</a></td>
                <td>${d.employee_name || d.employee}</td>
                <td class="num">${format_currency(d.advance_amount)}</td>
                <td class="num">${format_currency(d.pending_amount)}</td>
                <td class="num">${format_currency(d.claimed_amount)}</td>
                <td class="num ${balance_class}">${format_currency(d.balance_amount)}</td>
            </tr>`;
    }).join('');

    return `
    <style>
        .adv-dash-wrap{
            border:1px solid #e3e7ee;
            border-radius:8px;
            overflow:hidden;
            margin-top:10px;
        }
        .adv-dash-table{
            width:100%;
            border-collapse:collapse;
            font-size:13px;
        }
        .adv-dash-table th{
            background:#f8f9fb;
            text-align:left;
            padding:10px 14px;
            border-bottom:2px solid #e3e7ee;
            font-weight:600;
            color:#4b5563;
            text-transform:uppercase;
            font-size:11px;
            letter-spacing:0.3px;
        }
        .adv-dash-table td{
            padding:10px 14px;
            border-bottom:1px solid #eef0f4;
            color:#2d3748;
        }
        .adv-dash-table tbody tr:hover{
            background:#f9fafc;
        }
        .adv-dash-table tbody tr:last-child td{
            border-bottom:none;
        }
        .adv-dash-table .num{
            text-align:right;
            font-variant-numeric:tabular-nums;
        }
        .adv-dash-table .adv-link{
            font-weight:600;
            color:#2563eb;
            text-decoration:none;
        }
        .adv-dash-table .adv-link:hover{
            text-decoration:underline;
        }
        .adv-dash-table .balance-due{
            color:#dc2626;
            font-weight:700;
        }
        .adv-dash-table .balance-ok{
            color:#16a34a;
            font-weight:700;
        }
        .adv-dash-table tfoot td{
            font-weight:700;
            background:#f4f6f9;
            border-top:2px solid #e3e7ee;
            border-bottom:none;
            color:#1a202c;
        }
    </style>
    <div class="adv-dash-wrap">
        <table class="adv-dash-table">
            <thead>
                <tr>
                    <th>Advance Name</th>
                    <th>Employee</th>
                    <th class="num">Advance Amount</th>
                    <th class="num">Pending Amount</th>
                    <th class="num">Claimed Amount</th>
                    <th class="num">Balance Amount</th>
                </tr>
            </thead>
            <tbody>${row_html}</tbody>
            <tfoot>
                <tr>
                    <td colspan="2">Total</td>
                    <td class="num">${format_currency(total_advance)}</td>
                    <td class="num">${format_currency(total_pending)}</td>
                    <td class="num">${format_currency(total_claimed)}</td>
                    <td class="num">${format_currency(total_balance)}</td>
                </tr>
            </tfoot>
        </table>
    </div>`;
}

function format_currency(v) {
    return frappe.format(flt(v), { fieldtype: 'Currency' });
}