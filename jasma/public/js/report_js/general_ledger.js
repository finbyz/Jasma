// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

frappe.query_reports["General Ledger"] = {
	onload: function (report) {
		if (report._gl_print_btn) {
			// report._gl_print_btn.remove();
			// report._gl_print_btn = null;
		}

		report._gl_print_btn = report.page.add_inner_button(
			__("Print"),
			function () {
				print_general_ledger_statement(report);
			}
		);
	},
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
			reqd: 1,
		},
		{
			fieldname: "finance_book",
			label: __("Finance Book"),
			fieldtype: "Link",
			options: "Finance Book",
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -1),
			reqd: 1,
			width: "60px",
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1,
			width: "60px",
		},
		{
			fieldname: "account",
			label: __("Account"),
			fieldtype: "MultiSelectList",
			options: "Account",
			get_data: function (txt) {
				return frappe.db.get_link_options("Account", txt, {
					company: frappe.query_report.get_filter_value("company"),
				});
			},
		},
		{
			fieldname: "voucher_no",
			label: __("Voucher No"),
			fieldtype: "Data",
			on_change: function () {
				frappe.query_report.set_filter_value("categorize_by", "Categorize by Voucher (Consolidated)");
			},
		},
		{
			fieldname: "against_voucher_no",
			label: __("Against Voucher No"),
			fieldtype: "Data",
		},
		{
			fieldtype: "Break",
		},
		{
			fieldname: "party_type",
			label: __("Party Type"),
			fieldtype: "Autocomplete",
			options: Object.keys(frappe.boot.party_account_types),
			on_change: function () {
				frappe.query_report.set_filter_value("party", []);
			},
		},
		{
			fieldname: "party",
			label: __("Party"),
			fieldtype: "MultiSelectList",
			options: "party_type",
			get_data: function (txt) {
				if (!frappe.query_report.filters) return;
				let party_type = frappe.query_report.get_filter_value("party_type");
				if (!party_type) return;
				return frappe.db.get_link_options(party_type, txt);
			},
			on_change: function () {
				var party_type = frappe.query_report.get_filter_value("party_type");
				var parties = frappe.query_report.get_filter_value("party");

				if (!party_type || parties.length === 0 || parties.length > 1) {
					frappe.query_report.set_filter_value("party_name", "");
					frappe.query_report.set_filter_value("tax_id", "");
					return;
				}

				var party = parties[0];
				var fieldname = erpnext.utils.get_party_name(party_type) || "name";
				frappe.db.get_value(party_type, party, fieldname, function (value) {
					frappe.query_report.set_filter_value("party_name", value[fieldname]);
				});

				if (party_type === "Customer" || party_type === "Supplier") {
					frappe.db.get_value(party_type, party, "tax_id", function (value) {
						frappe.query_report.set_filter_value("tax_id", value["tax_id"]);
					});
				}
			},
		},
		{
			fieldname: "party_name",
			label: __("Party Name"),
			fieldtype: "Data",
			hidden: 1,
		},
		{
			fieldname: "categorize_by",
			label: __("Categorize by"),
			fieldtype: "Select",
			options: [
				"",
				{ label: __("Categorize by Voucher"), value: "Categorize by Voucher" },
				{ label: __("Categorize by Voucher (Consolidated)"), value: "Categorize by Voucher (Consolidated)" },
				{ label: __("Categorize by Account"), value: "Categorize by Account" },
				{ label: __("Categorize by Party"), value: "Categorize by Party" },
			],
			default: "Categorize by Voucher (Consolidated)",
		},
		{
			fieldname: "tax_id",
			label: __("Tax Id"),
			fieldtype: "Data",
			hidden: 1,
		},
		{
			fieldname: "presentation_currency",
			label: __("Currency"),
			fieldtype: "Select",
			options: erpnext.get_presentation_currency_list(),
		},
		{
			fieldname: "cost_center",
			label: __("Cost Center"),
			fieldtype: "MultiSelectList",
			options: "Cost Center",
			get_data: function (txt) {
				return frappe.db.get_link_options("Cost Center", txt, {
					company: frappe.query_report.get_filter_value("company"),
				});
			},
		},
		
		{
			fieldname: "project",
			label: __("Project"),
			fieldtype: "MultiSelectList",
			options: "Project",
			get_data: function (txt) {
				return frappe.db.get_link_options("Project", txt, {
					company: frappe.query_report.get_filter_value("company"),
				});
			},
		},
		{
			fieldname: "include_dimensions",
			label: __("Consider Accounting Dimensions"),
			fieldtype: "Check",
			default: 1,
		},
		{
			fieldname: "show_opening_entries",
			label: __("Show Opening Entries"),
			fieldtype: "Check",
		},
		{
			fieldname: "include_default_book_entries",
			label: __("Include Default FB Entries"),
			fieldtype: "Check",
			default: 1,
		},
		{
			fieldname: "show_cancelled_entries",
			label: __("Show Cancelled Entries"),
			fieldtype: "Check",
		},
		{
			fieldname: "show_net_values_in_party_account",
			label: __("Show Net Values in Party Account"),
			fieldtype: "Check",
		},
		{
			fieldname: "show_amount_in_company_currency",
			label: __("Show Credit / Debit in Company Currency"),
			fieldtype: "Check",
		},
		{
			fieldname: "add_values_in_transaction_currency",
			label: __("Add Columns in Transaction Currency"),
			fieldtype: "Check",
		},
		{
			fieldname: "show_remarks",
			label: __("Show Remarks"),
			fieldtype: "Check",
		},
		{
			fieldname: "ignore_err",
			label: __("Ignore Exchange Rate Revaluation and Gain / Loss Journals"),
			fieldtype: "Check",
		},
		{
			fieldname: "ignore_cr_dr_notes",
			label: __("Ignore System Generated Credit / Debit Notes"),
			fieldtype: "Check",
		},
	],
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: safe float (works in all contexts)
// ─────────────────────────────────────────────────────────────────────────────
function _f(v) {
	var n = parseFloat(v);
	return isNaN(n) ? 0 : n;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN: called when button is clicked
// ─────────────────────────────────────────────────────────────────────────────
async function print_general_ledger_statement(report) {
	if (!report.data || !report.data.length) {
		frappe.msgprint(__("No data to print."));
		return;
	}

	frappe.show_alert({ message: __("Preparing print..."), indicator: "blue" });

	// STEP 1 — Deep copy so we never mutate report.data
	var raw = report.data.map(function(r) { return Object.assign({}, r); });

	// ─────────────────────────────────────────────────────────────────────────
	// STEP 2 — Collect all Sales Invoice voucher numbers from report.data
	// ─────────────────────────────────────────────────────────────────────────
	var si_voucher_nos = [];
	for (var i = 0; i < raw.length; i++) {
		var r = raw[i];
		if (
			r.voucher_type === "Sales Invoice" &&
			r.voucher_no &&
			si_voucher_nos.indexOf(r.voucher_no) === -1
		) {
			si_voucher_nos.push(r.voucher_no);
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STEP 3 — Fetch igst_refund_jv field from those Sales Invoices
	//
	// si_to_jv : { "SRET-26-00001": "ACC-JV-2026-00048", ... }
	//   Maps each Sales Invoice → its linked IGST Refund JV (if any)
	//
	// blocked_jvs : { "ACC-JV-2026-00048": "SRET-26-00001", ... }
	//   Maps each blocked JV → its parent Sales Invoice
	//   (so we know which SI debit to reduce)
	// ─────────────────────────────────────────────────────────────────────────
	var si_to_jv    = {};   // SI voucher_no  -> JV voucher_no
	var blocked_jvs = {};   // JV voucher_no  -> SI voucher_no

	if (si_voucher_nos.length > 0) {
		try {
			var si_records = await frappe.db.get_list("Sales Invoice", {
				filters: [
					["name",           "in",  si_voucher_nos],
					["igst_refund_jv", "!=",  ""            ],
				],
				fields: ["name", "igst_refund_jv"],
				limit: 0,
			});

			for (var i = 0; i < si_records.length; i++) {
				var si  = si_records[i].name;
				var jv  = si_records[i].igst_refund_jv;
				if (si && jv) {
					si_to_jv[si]    = jv;
					blocked_jvs[jv] = si;
				}
			}

		} catch (e) {
			console.error("[IGST Filter] Sales Invoice fetch failed:", e);
			// Non-fatal — print without IGST adjustment
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STEP 4 — For each blocked JV visible in report.data,
	//          read its credit amount and subtract from the linked SI debit.
	//
	//   When party filter is active:
	//     - The JV's Debtors USD leg (Credit) IS visible in report.data
	//     - The JV's IGST Refund leg  (Debit)  is hidden by party filter
	//   So we safely read the credit from whichever JV row appears in report.data.
	// ─────────────────────────────────────────────────────────────────────────
	for (var jv_no in blocked_jvs) {
		var linked_si = blocked_jvs[jv_no];

		// Find the JV row in report.data (the party-side / Debtors USD leg)
		var jv_row = null;
		for (var i = 0; i < raw.length; i++) {
			if (raw[i].voucher_no === jv_no && raw[i].posting_date) {
				jv_row = raw[i];
				break;
			}
		}

		if (!jv_row) continue;  // JV not in report range — nothing to do

		var reduction = _f(jv_row.credit);
		if (reduction <= 0) continue;

		// Find the linked Sales Invoice row and reduce its debit
		for (var i = 0; i < raw.length; i++) {
			if (raw[i].voucher_no === linked_si && raw[i].posting_date) {
				raw[i].debit = Math.max(0, _f(raw[i].debit) - reduction);
				break;
			}
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// STEP 5 — Remove ALL rows of blocked JVs from the output
	// ─────────────────────────────────────────────────────────────────────────
	var filtered = [];
	for (var i = 0; i < raw.length; i++) {
		var r = raw[i];
		if (r.voucher_type === "Journal Entry" && blocked_jvs[ r.voucher_no ]) {
			continue;  // drop this row
		}
		filtered.push(r);
	}

	// STEP 5 — Remove ALL IGST Refund JVs from output
	var filtered = raw.filter(function (row) {
		return !(row.voucher_no && blocked_jvs.hasOwnProperty(row.voucher_no));
	});

	// STEP 6 — Recalculate running balance on adjusted, filtered data
	var print_data = recalculate_balances(filtered);

	// STEP 7 — Build HTML rows
	var filters  = report.get_filter_values();
	var currency = filters.presentation_currency;

	var rows_html = "";
	for (var i = 0; i < print_data.length; i++) {
		var d   = print_data[i];
		var cur = currency || d.account_currency || "";

		if (d.posting_date) {
			rows_html += "<tr>";
			rows_html += "<td>" + frappe.datetime.str_to_user(d.posting_date) + "</td>";
			rows_html += "<td>" + (d.voucher_type || "") + "<br>" + (d.voucher_no || "") + "</td>";
			rows_html += "<td>" + (d.remarks || (d.bill_no ? "Supplier Invoice No: " + d.bill_no : "")) + "</td>";
			rows_html += "<td style='text-align:right'>" + format_currency(d.debit,   cur) + "</td>";
			rows_html += "<td style='text-align:right'>" + format_currency(d.credit,  cur) + "</td>";
			rows_html += "<td style='text-align:right'>" + format_currency(d.balance, cur) + "</td>";
			rows_html += "</tr>";
		} else {
			rows_html += "<tr style='font-weight:bold;background:#f5f5f5'>";
			rows_html += "<td></td>";
			rows_html += "<td></td>";
			rows_html += "<td>" + (d.account || "") + "</td>";
			rows_html += "<td style='text-align:right'>" + (d.debit  != null ? format_currency(d.debit,  cur) : "") + "</td>";
			rows_html += "<td style='text-align:right'>" + (d.credit != null ? format_currency(d.credit, cur) : "") + "</td>";
			rows_html += "<td style='text-align:right'>" + format_currency(d.balance, cur) + "</td>";
			rows_html += "</tr>";
		}
	}

	// STEP 8 — Heading
	var heading = "";
	if (filters.party_name)                         heading = filters.party_name;
	else if (filters.party && filters.party.length) heading = filters.party;
	else if (filters.account)                       heading = filters.account;

	var tax_line = filters.tax_id
		? "<h6 style='text-align:center'>Tax Id: " + filters.tax_id + "</h6>"
		: "";

	var date_range =
		frappe.datetime.str_to_user(filters.from_date) +
		" to " +
		frappe.datetime.str_to_user(filters.to_date);

	var printed_on = "Printed on " +
		frappe.datetime.str_to_user(frappe.datetime.get_datetime_as_string());

	// STEP 9 — Full HTML page
	var full_html = `<!DOCTYPE html>
<html>
<head >
<meta charset="utf-8">
<title>Statement of Account</title>
<style>
* {
    box-sizing: border-box;
}

body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    color: #000;
    background: #fff;
    padding: 20px;
    margin: 0;
}

h2 {
    text-align: center;
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 12px 0;
}

h4 {
    text-align: center;
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 5px 0;
}

h5 {
    text-align: center;
    font-size: 13px;
    font-weight: normal;
    margin: 0 0 10px 0;
}

h6 {
    text-align: center;
    font-size: 12px;
    font-weight: normal;
    margin: 0 0 5px 0;
}

hr {
    border: 0;
    border-top: 1px solid #d1d8dd;
    margin: 15px 0;
}

table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 20px;
}

thead th {
    background: #f7f7f7;
    font-weight: 600;
    text-align: left;
    border: 1px solid #d1d8dd;
    padding: 10px 8px;
}

tbody td {
    border: 1px solid #d1d8dd;
    padding: 10px 8px;
    vertical-align: top;
}

.text-right {
    text-align: right;
}

.summary-row {
    font-weight: 600;
    background: #fafafa;
}

.footer {
    text-align: right;
    color: #7c8592;
    font-size: 11px;
    margin-top: 25px;
}

@media print {

    body {
        padding: 0;
    }

    @page {
        size: A4 landscape;
        margin: 10mm;
    }

    thead {
        display: table-header-group;
    }

    tr {
        page-break-inside: avoid;
    }
}
</style>
</head>
<body >
<h2>Statement of Account</h2>
${heading ? "<h4>" + heading + "</h4>" : ""}
${tax_line}
<h5>${date_range}</h5>
<hr>
<table>
	<thead>
    <tr>
      <th style="width:11%">Date</th>
      <th style="width:16%">Reference</th>
      <th style="width:26%">Remarks</th>
      <th style="width:15%;text-align:right">Debit</th>
      <th style="width:15%;text-align:right">Credit</th>
      <th style="width:17%;text-align:right">Balance (Dr - Cr)</th>
    </tr>
  </thead>
  <tbody class="print-format">
    ${rows_html}
  </tbody>
</table>
<p class="footer">${printed_on}</p>
</body>
</html>`;

	// STEP 10 — Open print window
	var w = window.open("", "_blank");
	if (!w) {
		frappe.msgprint(__("Pop-ups are blocked. Please allow pop-ups and try again."));
		return;
	}
	w.document.open();
	w.document.write(full_html);
	w.document.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// Recalculate running balance after filter + debit adjustments
// ─────────────────────────────────────────────────────────────────────────────
function recalculate_balances(data) {
	var running = 0;
	var opening = 0;
	var tot_dr = 0;
	var tot_cr = 0;

	return data.map(function (row) {
		var r = Object.assign({}, row);

		// Normal GL Entry Row
		if (r.posting_date) {
			r.debit = _f(r.debit);
			r.credit = _f(r.credit);

			tot_dr += r.debit;
			tot_cr += r.credit;

			running += r.debit - r.credit;
			r.balance = running;

			return r;
		}

		// var label = r.account || "";
		// console.log("Label =", label);

		// // Opening Row
		// if (label.indexOf("Opening") !== -1) {
		// 	opening = _f(r.debit) - _f(r.credit);
		// 	running = opening;
		// 	r.balance = running;
		// }

		// else if (label === "Closing (Opening + Total)" !== -1 ) {
		// 	var closing_balance = opening + (tot_dr - tot_cr);

		// 	r.debit = opening + tot_dr;
		// 	r.credit = opening + tot_cr;
		// 	r.balance = closing_balance;

		// 	console.log("Closing Row:", {
		// 		opening: opening,
		// 		total_debit: tot_dr,
		// 		total_credit: tot_cr,
		// 		closing_balance: closing_balance
		// 	});
		// }

		// // Total Row
		// else if (
		// 	label.indexOf("Total") !== -1
		// ) {
		// 	r.debit = tot_dr;
		// 	r.credit = tot_cr;
		// 	r.balance = tot_dr - tot_cr;

		// 	console.log("total Row:", {
		// 		tot_dr: tot_dr,
		// 		tot_cr: tot_cr
		// 	});
		// }

		// // Closing Row
		// else if (label.indexOf("Closing (Opening + Total)") !== -1) {
		// 	var closing_balance = opening + (tot_dr - tot_cr);

		// 	r.debit = opening + tot_dr;
		// 	r.credit = opening + tot_cr;
		// 	r.balance = closing_balance;

		// 	console.log("Closing Row:", {
		// 		opening: opening,
		// 		total_debit: tot_dr,
		// 		total_credit: tot_cr,
		// 		closing_balance: closing_balance
		// 	});
		// }
		var label = (r.account || "").replace(/'/g, "").trim();

if (label === "Closing (Opening + Total)") {

    var closing_balance = opening + (tot_dr - tot_cr);

    if (opening >= 0) {
        // Opening Debit Balance
        r.debit = opening + tot_dr;
        r.credit = tot_cr;
    } else {
        // Opening Credit Balance
        r.debit = tot_dr;
        r.credit = Math.abs(opening) + tot_cr;
    }

    r.balance = closing_balance;

    console.log("Closing Row:", {
        opening: opening,
        total_debit: tot_dr,
        total_credit: tot_cr,
        closing_balance: closing_balance,
        closing_debit: r.debit,
        closing_credit: r.credit
    });
}
else if (label === "Opening") {

    opening = _f(r.debit) - _f(r.credit);
    running = opening;
    r.balance = running;
}
else if (label === "Total") {

    r.debit = tot_dr;
    r.credit = tot_cr;
    r.balance = tot_dr - tot_cr;
}

		return r;
	});
}

erpnext.utils.add_dimensions("General Ledger", 15);