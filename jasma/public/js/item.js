frappe.ui.form.on("Item", {
    setup: function(frm) {
        frm.set_query("service_item", function() {
            return {
                filters: {
                    is_stock_item: 0
                }
            };
        });
    },
    refresh(frm) {
        check_forecast_permission(function () {
            render_export_forecast(frm);
            render_quotation_forecast(frm);
        });
	},
	item_code(frm) {
        check_forecast_permission(function () {
            render_export_forecast(frm);
            render_quotation_forecast(frm);
        });
	}
});

function check_forecast_permission(callback) {
	if (frappe.boot.export_forecast_permission !== undefined) {
		callback();
		return;
	}

	frappe.call({
		method: "jasma.jasma.doc_events.item.has_forecast_permission",
		callback: function (r) {
			frappe.boot.export_forecast_permission = !!r.message;
			callback();
		}
	});
}

// Shared styles injected once
if (!document.getElementById("forecast-widget-styles")) {
	const style = document.createElement("style");
	style.id = "forecast-widget-styles";
	style.innerHTML = `
		.forecast-section { font-family: inherit; }
		.forecast-title {
			font-weight: 600;
			font-size: 13px;
			padding: 8px 0 6px;
			display: flex;
			align-items: center;
			justify-content: space-between;
		}
		.forecast-header-row {
			display: flex;
			align-items: flex-start;
			font-weight: 600;
			font-size: 11px;
			text-transform: uppercase;
			letter-spacing: 0.02em;
			color: var(--text-muted);
			padding: 6px 8px;
			border-bottom: 1px solid var(--border-color);
		}
		.forecast-header-row > div {
			white-space: nowrap;
			padding-right: 6px;
		}
		.forecast-data-row {
			display: flex;
			align-items: flex-start;
			padding: 8px 8px;
			border-bottom: 1px solid var(--border-color);
			transition: background 0.15s ease;
		}
		.forecast-data-row:hover {
			background: var(--control-bg);
		}
		.forecast-cell {
			padding-right: 6px;
		}
		.forecast-wrap {
			white-space: normal;
			word-break: break-word;
			overflow-wrap: break-word;
			line-height: 1.35;
		}
		.forecast-total-row {
			display: flex;
			align-items: center;
			padding: 8px 8px;
			border-top: 2px solid var(--border-color);
			font-weight: 700;
			background: var(--subtle-fg);
		}
		.forecast-btn {
			border: 1px solid var(--border-color);
			background: var(--fg-color, #fff);
			border-radius: 6px;
			padding: 4px 12px;
			font-size: 12px;
			font-weight: 500;
			cursor: pointer;
			white-space: nowrap;
			transition: all 0.15s ease;
		}
		.forecast-btn:hover {
			background: var(--control-bg);
			border-color: var(--dark-border-color, #ccc);
		}
		.forecast-btn:active {
			transform: scale(0.97);
		}
		.forecast-empty {
			padding: 14px 8px;
			color: var(--text-muted);
			font-size: 12px;
		}
	`;
	document.head.appendChild(style);
}

function render_summary_view(wrapper, title, data, frm, detail_render_fn, committed_label) {
	committed_label = committed_label || "Committed Qty";
	const can_view_details = !!frappe.boot.export_forecast_permission;

	wrapper.html(`
		<div class="forecast-section">
			<div class="forecast-title">${title}</div>
			<div class="forecast-header-row">
				<div style="flex:0 0 85px;" class="forecast-cell">Item Code</div>
				<div style="flex:0 0 450px;" class="forecast-cell">Item Name</div>
				<div style="flex:0 0 70px; text-align:right;" class="forecast-cell">Qty</div>
				<div style="flex:0 0 100px; text-align:right;" class="forecast-cell">${committed_label} </div>
				<div style="flex:1; text-align:right;"></div>
			</div>
			<div class="forecast-data-row">
				<div style="flex:0 0 85px; font-weight:500;" class="forecast-cell">${frm.doc.item_code}</div>
				<div style="flex:0 0 450px;" class="text-muted small forecast-wrap forecast-cell">${frm.doc.item_name || ""}</div>
				<div style="flex:0 0 70px; text-align:right;" class="forecast-cell">${format_number(data.total_pending_qty)}</div>
				<div style="flex:0 0 100px; text-align:right; font-weight:600;" class="forecast-cell">${format_number(data.total_committed_qty)}</div>
				<div style="flex:1; text-align:right;">
					${can_view_details ? '<button class="forecast-btn view-details-btn">View Details</button>' : ''}
				</div>
			</div>
		</div>
	`);

	if (can_view_details) {
		wrapper.find(".view-details-btn").on("click", function () {
			detail_render_fn(wrapper, title, data, frm);
		});
	}
}

function render_export_forecast(frm) {
	if (frm.is_new() || !frm.doc.item_code) return;

	frappe.call({
		method: "jasma.jasma.doc_events.item.get_export_forecast_data",
		args: { item_code: frm.doc.item_code },
		callback: function (r) {
			const data = r.message || { rows: [], total_pending_qty: 0, total_committed_qty: 0 };
			const wrapper = frm.get_field("export_forcast").$wrapper;

			if (!data.rows.length) {
				wrapper.html(`
					<div class="forecast-section">
						<div class="forecast-title">Export Committed</div>
						<div class="forecast-empty">No open Sales Order demand for this item.</div>
					</div>
				`);
				return;
			}

			render_summary_view(wrapper, "Export Committed", data, frm, render_export_forecast_details, "Committed");
		}
	});
}

function render_export_forecast_details(wrapper, title, data, frm) {
	let rows_html = `
		<div class="forecast-section">
			<div class="forecast-title">
				${title}
				<button class="forecast-btn back-to-summary-btn">Back to Summary</button>
			</div>
			<div class="forecast-header-row">
				<div style="flex:0 0 100px;" class="forecast-cell">Sales Order</div>
				<div style="flex:0 0 80px;" class="forecast-cell">FG Code</div>
				<div style="flex:0 0 440px;" class="forecast-cell">FG Name</div>
				<div style="flex:0 0 70px; text-align:right;" class="forecast-cell">Qty</div>
				<div style="flex:0 0 100px; text-align:right;">Committed</div>
			</div>
	`;

	data.rows.forEach(function (row) {
		rows_html += `
			<div class="forecast-data-row">
				<div style="flex:0 0 100px; font-weight:500;" class="forecast-cell">${row.so_name}</div>
				<div style="flex:0 0 80px;" class="forecast-wrap forecast-cell">${row.fg_item || ""}</div>
				<div style="flex:0 0 440px;" class="text-muted small forecast-wrap forecast-cell">${row.fg_item_name || ""}</div>
				<div style="flex:0 0 70px; text-align:right;" class="forecast-cell">${format_number(row.pending_qty)}</div>
				<div style="flex:0 0 100px; text-align:right; font-weight:600;">${format_number(row.committed_qty)}</div>
			</div>
		`;
	});

	rows_html += `
			<div class="forecast-total-row">
				<div style="flex:0 0 100px;" class="forecast-cell">Total</div>
				<div style="flex:0 0 80px;" class="forecast-cell"></div>
				<div style="flex:0 0 440px;" class="forecast-cell"></div>
				<div style="flex:0 0 70px; text-align:right;" class="forecast-cell">${format_number(data.total_pending_qty)}</div>
				<div style="flex:0 0 100px; text-align:right;">${format_number(data.total_committed_qty)}</div>
			</div>
		</div>
	`;

	wrapper.html(rows_html);

	wrapper.find(".back-to-summary-btn").on("click", function () {
		render_summary_view(wrapper, title, data, frm, render_export_forecast_details, "Committed");
	});
}

function render_quotation_forecast(frm) {
	if (frm.is_new() || !frm.doc.item_code) return;

	frappe.call({
		method: "jasma.jasma.doc_events.item.get_quotation_forecast_data",
		args: { item_code: frm.doc.item_code },
		callback: function (r) {
			const data = r.message || { rows: [], total_pending_qty: 0, total_committed_qty: 0 };
			const wrapper = frm.get_field("export_commited").$wrapper;

			if (!data.rows.length) {
				wrapper.html(`
					<div class="forecast-section">
						<div class="forecast-title">Export Forecast</div>
						<div class="forecast-empty">No open Quotation demand for this item.</div>
					</div>
				`);
				return;
			}

			render_summary_view(wrapper, "Export Forecast", data, frm, render_quotation_forecast_details, "Forecast Qty");
		}
	});
}

function render_quotation_forecast_details(wrapper, title, data, frm) {
	let rows_html = `
		<div class="forecast-section">
			<div class="forecast-title">
				${title}
				<button class="forecast-btn back-to-summary-btn">Back to Summary</button>
			</div>
			<div class="forecast-header-row">
				<div style="flex:0 0 100px;" class="forecast-cell">Quotation</div>
				<div style="flex:0 0 80px;" class="forecast-cell">FG Code</div>
				<div style="flex:0 0 440px;" class="forecast-cell">FG Name</div>
				<div style="flex:0 0 70px; text-align:right;" class="forecast-cell">Qty</div>
				<div style="flex:0 0 100px; text-align:right;">Forecast Qty</div>
			</div>
	`;

	data.rows.forEach(function (row) {
		rows_html += `
			<div class="forecast-data-row">
				<div style="flex:0 0 100px; font-weight:500;" class="forecast-cell">${row.qtn_name}</div>
				<div style="flex:0 0 80px;" class="forecast-wrap forecast-cell">${row.fg_item || ""}</div>
				<div style="flex:0 0 440px;" class="text-muted small forecast-wrap forecast-cell">${row.fg_item_name || ""}</div>
				<div style="flex:0 0 70px; text-align:right;" class="forecast-cell">${format_number(row.pending_qty)}</div>
				<div style="flex:0 0 100px; text-align:right; font-weight:600;">${format_number(row.committed_qty)}</div>
			</div>
		`;
	});

	rows_html += `
			<div class="forecast-total-row">
				<div style="flex:0 0 100px;" class="forecast-cell">Total</div>
				<div style="flex:0 0 80px;" class="forecast-cell"></div>
				<div style="flex:0 0 440px;" class="forecast-cell"></div>
				<div style="flex:0 0 70px; text-align:right;" class="forecast-cell">${format_number(data.total_pending_qty)}</div>
				<div style="flex:0 0 100px; text-align:right;">${format_number(data.total_committed_qty)}</div>
			</div>
		</div>
	`;

	wrapper.html(rows_html);

	wrapper.find(".back-to-summary-btn").on("click", function () {
		render_summary_view(wrapper, title, data, frm, render_quotation_forecast_details, "Forecast Qty");
	});
}