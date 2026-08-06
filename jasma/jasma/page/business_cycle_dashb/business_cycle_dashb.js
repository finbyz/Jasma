const business_cycle_dashboard_routes = [
	"business-cycle_dashb",
	"business-cycle-dashb",
	"business_cycle_dashb",
];

function ensure_business_cycle_dashboard(wrapper) {
	frappe.require("/assets/jasma/css/business_cycle_dashboard.css", () => {
		if (!wrapper.business_cycle_dashb) {
			wrapper.business_cycle_dashb = new MELBusinessCycleDashboard(wrapper);
		}
	});
	if (!wrapper.business_cycle_dashb) {
		wrapper.business_cycle_dashb = new MELBusinessCycleDashboard(wrapper);
	}
}

business_cycle_dashboard_routes.forEach((route) => {
	if (frappe.pages[route]) {
		frappe.pages[route].on_page_load = function (wrapper) {
			ensure_business_cycle_dashboard(wrapper);
		};

		frappe.pages[route].on_page_show = function (wrapper) {
			if (wrapper.business_cycle_dashb && !wrapper.business_cycle_dashb.loading) {
				wrapper.business_cycle_dashb.refresh();
			}
		};
	}
});

// ─── Utility: Format date string (YYYY-MM-DD) → DD/MM/YYYY ──────────────────
function fmt_date(val) {
	if (!val || val === "—") return "—";
	const s = String(val).split(" ")[0]; // strip time if any
	const parts = s.split("-");
	if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
	return s;
}

class MELBusinessCycleDashboard {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Procurement & Business Cycle Dashboard"),
			single_column: true,
		});
		this.api = "jasma.jasma.page.business_cycle_dashb.business_cycle_dashb";
		this.cycle = "sales";
		this.data = null;
		this.procurement_cards = [];
		this.stock_data = [];
		this.supplier_data = [];
		this.current_stage = null;
		this.current_records = [];
		this.controls = {};
		this.loading = false;
		this.refresh_timer = null;
		this.suppress_filter_refresh = true;

		this.colors = {
			mr_approved: { cls: "clr-cyan", icon: "octicon octicon-file", clr: "#0891b2" },
			po_pending: { cls: "clr-amber", icon: "octicon octicon-shopping-bag", clr: "#d97706" },
			subcon_po: { cls: "clr-indigo", icon: "octicon octicon-git-branch", clr: "#4f46e5" },
			pr_pending: { cls: "clr-slate", icon: "octicon octicon-list-unordered", clr: "#475569" },
			qc_pending: { cls: "clr-emerald", icon: "octicon octicon-search", clr: "#059669" },
			nc_pending: { cls: "clr-rose", icon: "octicon octicon-alert", clr: "#e11d48" },
			overdue_po: { cls: "clr-red", icon: "octicon octicon-clock", clr: "#dc2626" },
		};

		this.build();
		this.suppress_filter_refresh = false;
		this.bind_events();
		this.configure_page_actions();
		this.refresh();
	}

	build() {
		this.$main = $(`
			<div class="mel-cycle-dashboard">
				<div class="toast-box" id="mel-toasts"></div>
				<div class="modal-wrap" id="mel-modal">
					<div class="modal-bg"></div>
					<div class="modal-box" id="mel-modalBody" style="max-width:900px;width:90%;"></div>
				</div>

				<div class="sec-bar">
					<div>
						<div class="sec-title">${__("Dashboard Overview")}</div>
						<div class="sec-sub">${__("Click any card to view detailed stage records")}</div>
					</div>
					<div class="mel-filter-grid" style="display:flex;gap:10px;align-items:center;">
						<div class="mel-filter-control" data-filter="company"></div>
						<div class="mel-filter-control" data-filter="from_date"></div>
						<div class="mel-filter-control" data-filter="to_date"></div>
						<button class="btn btn-default mel-clear-filters" type="button">${__("Clear")}</button>
					</div>
				</div>

				<div style="padding: 8px 24px 28px 24px;">
					<div class="grid-7" id="mel-cardGrid"></div>
				</div>

				<div class="sec-bar">
					<div>
						<div class="sec-title">${__("Stock Overview")}</div>
						<div class="sec-sub">${__("Item-wise stock levels, valuation, and export commitments")}</div>
					</div>
					<div style="display:flex; align-items:center; gap:12px;">
						<input type="text" class="f-input-light" id="mel-stockSearch" placeholder="${__("Search items...")}" style="width:360px;">
						<button class="btn-b mel-export-stock" type="button" style="padding:10px 20px;border-radius:9999px;">
							${__("Export Stock CSV")}
						</button>
					</div>
				</div>
				<div style="padding: 8px 24px 32px 24px;">
					<div class="tbl-wrap">
						<div class="tbl-scroll">
							<table class="dtable" id="mel-stockTbl">
								<thead>
									<tr>
										<th>${__("Item Name")}</th>
										<th style="white-space:nowrap;">${__("JPC")}</th>
										<th style="white-space:nowrap;">${__("Valuation Rate")}</th>
										<th style="white-space:nowrap;">${__("Total Stock")}</th>
										<th title="${__("Qty not yet received past required date")}">${__("Pending Orders")}</th>
										<th style="width:110px;line-height:1.2;">${__("Export Commitment")}</th>
										<th style="width:110px;line-height:1.2;">${__("Export Forecast")}</th>
										<th style="width:100px;">${__("Actions")}</th>
									</tr>
								</thead>
								<tbody id="mel-stockBody"></tbody>
							</table>
						</div>
					</div>
				</div>

				<div class="sec-bar">
					<div>
						<div class="sec-title">${__("Supplier Performance")}</div>
						<div class="sec-sub">${__("Order history, NC tracking, and PO delay analysis")}</div>
					</div>
					<input type="text" class="f-input-light" id="mel-suppSearch" placeholder="${__("Search suppliers...")}" style="width:360px;">
				</div>
				<div style="padding: 8px 24px 32px 24px;">
					<div class="tbl-wrap">
						<div class="tbl-scroll">
							<table class="dtable" id="mel-suppTbl">
								<thead>
									<tr>
										<th>${__("Supplier Name")}</th>
										<th>${__("Total Orders")}</th>
										<th>${__("Total Value")}</th>
										<th>${__("NC Count")}</th>
										<th>${__("PO Delayed")}</th>
										<th>${__("Avg Delay")}</th>
										<th>${__("Contract Expiry")}</th>
										<th>${__("Actions")}</th>
									</tr>
								</thead>
								<tbody id="mel-suppBody"></tbody>
							</table>
						</div>
					</div>
				</div>
			</div>
		`).appendTo(this.page.main);

		this.make_filter_controls();
	}

	make_filter_controls() {
		const today = frappe.datetime.get_today();
		const from_date = frappe.datetime.add_months(today, -1);
		const company = frappe.defaults.get_user_default("Company");

		this.controls.company = this.make_control("company", {
			fieldtype: "Link",
			options: "Company",
			label: __("Company"),
			default: company,
		});
		this.controls.from_date = this.make_control("from_date", {
			fieldtype: "Date",
			label: __("From Date"),
			default: from_date,
		});
		this.controls.to_date = this.make_control("to_date", {
			fieldtype: "Date",
			label: __("To Date"),
			default: today,
		});
	}

	make_control(slot, df) {
		const parent = this.$main.find(`[data-filter="${slot}"]`).empty();
		const control = frappe.ui.form.make_control({
			parent,
			df: {
				...df,
				onchange: () => {
					if (!this.suppress_filter_refresh) this.refresh();
				},
			},
			render_input: true,
		});
		control.refresh();
		if (df.default) {
			control.set_value(df.default);
		}
		return control;
	}

	get_filters() {
		return {
			company: this.controls.company?.get_value() || "",
			from_date: this.controls.from_date?.get_value() || "",
			to_date: this.controls.to_date?.get_value() || "",
		};
	}

	configure_page_actions() {
		this.page.set_primary_action(__("Refresh"), () => this.refresh(), "refresh");
	}

	bind_events() {
		this.$main.on("click", ".modal-bg, [data-close-modal]", () => this.close_modal());
		this.$main.on("click", ".mel-clear-filters", () => this.clear_filters());

		this.$main.on("input", "#mel-stockSearch", (e) => {
			const query = $(e.currentTarget).val().toLowerCase();
			this.render_stock_table(query);
		});

		this.$main.on("input", "#mel-suppSearch", (e) => {
			const query = $(e.currentTarget).val().toLowerCase();
			this.render_supplier_table(query);
		});

		this.$main.on("click", ".dash-card", (e) => {
			const cid = $(e.currentTarget).data("cid");
			this.open_stage_list_dialog(cid);
		});

		this.$main.on("click", ".mel-open-filtered-desk-list", (e) => {
			const $t = $(e.currentTarget);
			const cid = $t.data("cid");
			const doctype = $t.data("doctype");
			this.open_filtered_desk_list(cid, doctype);
		});

		// Export Forecast → Quotation dialog
		this.$main.on("click", ".mel-view-export-forecast", (e) => {
			const $t = $(e.currentTarget);
			this.open_export_forecast_modal($t.data("item"), $t.data("item-code"));
		});

		// Export Commitment → SO dialog with date filter
		this.$main.on("click", ".mel-view-export-commitment", (e) => {
			const $t = $(e.currentTarget);
			const filters = this.get_filters();
			this.open_export_commitment_modal(
				$t.data("item"),
				$t.data("item-code"),
				filters.from_date,
				filters.to_date
			);
		});

		// Pending Orders (overdue PO qty) → PO dialog
		this.$main.on("click", ".mel-view-pending-po", (e) => {
			const $t = $(e.currentTarget);
			this.open_pending_po_modal($t.data("item"), $t.data("item-code"));
		});

		this.$main.on("click", ".mel-view-delayed-po", (e) => {
			const $t = $(e.currentTarget);
			this.open_delayed_po_drawer($t.data("supplier"), $t.data("supplier-code"));
		});

		this.$main.on("click", ".mel-export-stock", () => {
			this.export_stock_csv();
		});

		$(document).on("keydown.mel-dash", (e) => {
			if (e.key === "Escape") {
				this.close_modal();
			}
		});
	}

	clear_filters() {
		this.suppress_filter_refresh = true;
		this.controls.company.set_value(frappe.defaults.get_user_default("Company") || "");
		this.controls.from_date.set_value("");
		this.controls.to_date.set_value("");
		this.suppress_filter_refresh = false;
		this.refresh();
	}

	async call(method, args = {}) {
		const response = await frappe.call({
			method: `${this.api}.${method}`,
			args,
		});
		return response.message;
	}

	async refresh() {
		if (this.loading) return;
		this.loading = true;

		try {
			const filters = this.get_filters();
			const [dashboard_data, stock, suppliers] = await Promise.all([
				this.call("get_dashboard", { cycle: "sales", ...filters }),
				this.call("get_stock_overview", { from_date: filters.from_date, to_date: filters.to_date }),
				this.call("get_supplier_performance", {}),
			]);
			this.data = dashboard_data;
			this.procurement_cards = dashboard_data?.procurement_cards || [];
			this.stock_data = stock || [];
			this.supplier_data = suppliers || [];

			this.render_overview_cards();
			this.render_stock_table();
			this.render_supplier_table();
		} catch (error) {
			this.toast(error?.message || __("Could not refresh dashboard."));
		} finally {
			this.loading = false;
		}
	}

	// async refresh() {
	// 	if (this.loading) return;
	// 	this.loading = true;

	// 	try {
	// 		const filters = this.get_filters();
	// 		const [dashboard_data, stock, suppliers] = await Promise.all([
	// 			this.call("get_dashboard", { cycle: "sales", ...filters }),
	// 			this.call("get_stock_overview", {}),
	// 			this.call("get_supplier_performance", {}),
	// 		]);
	// 		this.data = dashboard_data;
	// 		this.procurement_cards = dashboard_data?.procurement_cards || [];
	// 		this.stock_data = stock || [];
	// 		this.supplier_data = suppliers || [];

	// 		this.render_overview_cards();
	// 		this.render_stock_table();
	// 		this.render_supplier_table();
	// 	} catch (error) {
	// 		this.toast(error?.message || __("Could not refresh dashboard."));
	// 	} finally {
	// 		this.loading = false;
	// 	}
	// }

	render_overview_cards() {
		const $grid = this.$main.find("#mel-cardGrid").empty();
		let html = "";
		const cards = this.procurement_cards || [];

		cards.forEach((c, idx) => {
			const config = this.colors[c.id] || { cls: "clr-slate", icon: "octicon octicon-file", clr: "#475569" };
			html += `
				<div class="dash-card ${config.cls} anim-in" style="animation-delay:${idx * 0.05}s" data-cid="${c.id}">
					${c.urg ? `<div class="urgent-dot"></div>` : ""}
					<div class="card-icon"><i class="${config.icon}"></i></div>
					<div class="card-num" data-ct="${c.count}">${c.count}</div>
					<div class="card-label">${frappe.utils.escape_html(c.title)}</div>
					<div class="card-hint"><i class="octicon octicon-link-external" style="margin-right:6px;"></i>${__("Click to View")}</div>
				</div>
			`;
		});
		$grid.html(html || `<div class="text-muted p-4">${__("No procurement cards available")}</div>`);
	}

	render_stock_table(filter_query = "") {
		const $body = this.$main.find("#mel-stockBody").empty();
		let items = this.stock_data || [];

		if (filter_query) {
			items = items.filter((i) => (i.item && i.item.toLowerCase().includes(filter_query)) || (i.jpc && i.jpc.toLowerCase().includes(filter_query)));
		}

		let html = "";
		items.forEach((it) => {
			const pending_po = it.pending_po_qty || 0;
			const export_commit = it.export || 0;
			const export_fcast = it.export_forecast || 0;
			const pending_po_cls = pending_po > 0 ? "bdg-rose" : "bdg-green";
			const export_cls = export_commit > 0 ? "bdg-amber" : "bdg-slate";
			const fcast_cls = export_fcast > 0 ? "bdg-cyan" : "bdg-slate";

			html += `
				<tr>
					<td style="max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${frappe.utils.escape_html(it.item)}"><strong>${frappe.utils.escape_html(it.item)}</strong></td>
					<td style="white-space:nowrap;font-weight:700;color:#000000;">${frappe.utils.escape_html(it.jpc)}</td>
					<td style="white-space:nowrap;">${format_currency(it.rate)}</td>
					<td style="white-space:nowrap;"><span class="bdg ${it.stock > 0 ? "bdg-green" : "bdg-amber"}">${it.stock}</span></td>
					<td>
						<button class="btn-s mel-view-pending-po ${pending_po > 0 ? "btn-s-danger" : ""}"
							data-item="${frappe.utils.escape_html(it.item)}"
							data-item-code="${frappe.utils.escape_html(it.item_code || it.item)}">
							<span class="bdg ${pending_po_cls}" style="font-size:12px;">${pending_po}</span>
						</button>
					</td>
					<td>
						<button class="btn-s mel-view-export-commitment"
							data-item="${frappe.utils.escape_html(it.item)}"
							data-item-code="${frappe.utils.escape_html(it.item_code || it.item)}">
							<span class="bdg ${export_cls}" style="font-size:12px;">${export_commit}</span>
						</button>
					</td>
					<td>
						<button class="btn-s mel-view-export-forecast"
							data-item="${frappe.utils.escape_html(it.item)}"
							data-item-code="${frappe.utils.escape_html(it.item_code || it.item)}">
							<span class="bdg ${fcast_cls}" style="font-size:12px;">${export_fcast}</span>
						</button>
					</td>
					<td>
						<button class="btn-b" onclick="frappe.set_route('Form', 'Item', '${frappe.utils.escape_html(it.item_code || it.item)}')">
							${__("View Item")}
						</button>
					</td>
				</tr>
			`;
		});
		$body.html(html || `<tr><td colspan="8" class="text-center text-muted p-4">${__("No stock records found")}</td></tr>`);
	}

	render_supplier_table(filter_query = "") {
		const $body = this.$main.find("#mel-suppBody").empty();
		let sups = this.supplier_data || [];

		if (filter_query) {
			sups = sups.filter((s) => s.name && s.name.toLowerCase().includes(filter_query));
		}

		let html = "";
		sups.forEach((s) => {
			// Contract expiry badge
			let contract_html = "";
			const cs = s.contract_status || "none";
			if (cs === "expired") {
				contract_html = `<span class="bdg bdg-contract-expired">🔴 ${frappe.utils.escape_html(s.contract)} ${__("(Expired)")}</span>`;
			} else if (cs === "expiring_soon") {
				contract_html = `<span class="bdg bdg-contract-expiring">🟡 ${frappe.utils.escape_html(s.contract)} ${__("(Expiring Soon)")}</span>`;
			} else if (cs === "active") {
				contract_html = `<span class="bdg bdg-contract-ok">🟢 ${frappe.utils.escape_html(s.contract)}</span>`;
			} else {
				contract_html = `<span class="bdg bdg-slate">${__("No Contract")}</span>`;
			}

			html += `
				<tr>
					<td><strong>${frappe.utils.escape_html(s.name)}</strong></td>
					<td>${s.orders}</td>
					<td>${format_currency(s.value)}</td>
					<td><span class="bdg ${s.nc > 0 ? "bdg-rose" : "bdg-green"}">${s.nc}</span></td>
					<td>
						<button class="btn-s mel-view-delayed-po" data-supplier="${frappe.utils.escape_html(s.name)}" data-supplier-code="${frappe.utils.escape_html(s.supplier_code || s.name)}">
							${s.delayed} ${__("delayed")}
						</button>
					</td>
					<td>${s.avg}</td>
					<td>${contract_html}</td>
					<td>
						<button class="btn-b" onclick="frappe.set_route('Form', 'Supplier', '${frappe.utils.escape_html(s.supplier_code || s.name)}')">
							${__("Open Supplier")}
						</button>
					</td>
				</tr>
			`;
		});
		$body.html(html || `<tr><td colspan="8" class="text-center text-muted p-4">${__("No supplier records found")}</td></tr>`);
	}


	// ─── Stage Dialog (accordion, single-open, date formatted, no dupe button) ──
	open_stage_list_dialog(cid) {
		const cards = this.procurement_cards || [];
		const card = cards.find((c) => c.id === cid);
		if (!card) return;

		const card_default_doctype = card.doctype || "Purchase Order";
		const items = card.items || [];

		let rows_html = "";
		if (items.length) {
			items.forEach((it, idx) => {
				const row_id = `mel-row-${idx}`;
				// Use per-item doctype if available (e.g. QC Pending: PR vs SCR)
				const row_doctype = it.doctype || card_default_doctype;
				const date_display = fmt_date(it.date);

				// Status badge color
				const status_lc = (it.status || "").toLowerCase();
				let status_cls = "bdg-slate";
				if (status_lc.includes("draft")) status_cls = "bdg-amber";
				else if (status_lc.includes("overdue")) status_cls = "bdg-rose";
				else if (status_lc.includes("ordered") || status_lc.includes("received") || status_lc.includes("submitted")) status_cls = "bdg-green";

				rows_html += `
					<div class="mel-collapsible-row" id="${row_id}" data-row-idx="${idx}">
						<div class="mel-row-header" data-row-toggle="${row_id}">
							<span class="mel-row-chevron" id="${row_id}-icon">▶</span>
							<a class="mel-row-docid" onclick="event.stopPropagation();frappe.set_route('Form', '${row_doctype}', '${frappe.utils.escape_html(it.ao)}')">
								${frappe.utils.escape_html(it.ao)}
							</a>
							${row_doctype !== "Non - Conformance" ? `<span class="mel-row-doctype-hint">${frappe.utils.escape_html(it.item || "")}</span>` : ""}
							<span class="mel-row-date-badge">${date_display}</span>
							<span class="bdg ${status_cls} mel-row-status-badge">${frappe.utils.escape_html(it.status || "")}</span>
							${it.project ? `<span class="bdg bdg-indigo mel-row-project-badge" title="${__('Project')}: ${frappe.utils.escape_html(it.project)}" onclick="event.stopPropagation();frappe.set_route('Form','Project','${frappe.utils.escape_html(it.project)}')">&#128193; ${frappe.utils.escape_html(it.project)}</span>` : ""}
						</div>
						<div class="mel-row-detail" id="${row_id}-detail" style="display:none;">
						${(() => {
							if (row_doctype === "Non - Conformance") {
								return `
								<div style="padding:16px;background:#f8fafc;border-radius:8px;margin-bottom:12px;border:1px solid #e2e8f0;">
									<div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:4px;">${__("Product Name")}</div>
									<div style="font-size:14px;font-weight:600;color:#1e293b;">${frappe.utils.escape_html(it.item || "—")}</div>
								</div>`;
							}
							const doc_items = it.doc_items || [];
							if (!doc_items.length) {
								return `<div class="text-center text-muted" style="padding:14px 0;font-size:13px;">${__("No line items found")}</div>`;
							}
							const has_received_col = doc_items.some(di => di.received_qty > 0);
							const has_rate_col = doc_items.some(di => di.rate > 0);
							const trows = doc_items.map((di) => {
								const rem = has_received_col ? (di.qty - (di.received_qty || 0)) : null;
								const rem_cls = rem !== null && rem > 0 ? "bdg-amber" : "bdg-green";
								return `<tr>
									<td><span class="bdg bdg-indigo" style="font-size:11px;">${frappe.utils.escape_html(di.item_code)}</span></td>
									<td style="font-weight:600;">${frappe.utils.escape_html(di.item_name)}</td>
									<td style="text-align:right;"><span class="bdg bdg-slate">${di.qty} ${frappe.utils.escape_html(di.uom)}</span></td>
									${has_received_col ? `<td style="text-align:right;"><span class="bdg ${rem_cls}">${rem} ${__("rem")}</span></td>` : ""}
									<td style="color:#64748b;">${di.schedule_date ? fmt_date(di.schedule_date) : "—"}</td>
									${has_rate_col ? `<td style="color:#475569;">${di.rate > 0 ? format_currency(di.rate) : "—"}</td>` : ""}
								</tr>`;
							}).join("");
							return `
							<div class="mel-doc-items-scroll">
								<table class="mel-doc-items-table">
									<thead>
										<tr>
											<th>${__("Code")}</th>
											<th>${__("Item Name")}</th>
											<th style="text-align:right;">${__("Qty")}</th>
											${has_received_col ? `<th style="text-align:right;">${__("Remaining")}</th>` : ""}
											<th>${__("Req. Date")}</th>
											${has_rate_col ? `<th>${__("Rate")}</th>` : ""}
										</tr>
									</thead>
									<tbody>${trows}</tbody>
								</table>
							</div>`;
						})()}
						<div style="margin-top:10px;display:flex;justify-content:flex-end;">
							<button class="btn-b" type="button" onclick="frappe.set_route('Form', '${row_doctype}', '${frappe.utils.escape_html(it.ao)}')">
								<i class="octicon octicon-link-external" style="margin-right:6px;"></i>${__("Open Full Form")}
							</button>
						</div>
					</div>
					</div>
				`;
			});
		} else {
			rows_html = `<div class="text-center text-muted p-4">${__("No records found in database for this stage")}</div>`;
		}

		const content = `
			<div class="modal-head">
				<div>
					<div class="modal-head-title">${frappe.utils.escape_html(card.title)} — ${__("Detailed Record Inspection")}</div>
					<div class="modal-head-sub">${items.length} ${__("records in current workflow stage")}</div>
				</div>
				<div style="display:flex;align-items:center;gap:8px;">
					<button class="btn-x" data-close-modal type="button">✕</button>
				</div>
			</div>
			<div style="padding:16px 24px 8px 24px;display:flex;align-items:center;justify-content:space-between;">
				<input type="text" class="f-input-light" id="mel-dialogSearch" placeholder="${__("Search records...")}" style="width:300px;">
				<span style="font-size:13px;color:#64748b;">${__("DocType")}: <strong>${card_default_doctype}</strong></span>
			</div>
			<div style="padding:8px 24px 24px 24px;max-height:60vh;overflow-y:auto;" id="mel-collapsible-list">
				${rows_html}
			</div>
			<div style="padding:16px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;background:#f8fafc;border-bottom-left-radius:16px;border-bottom-right-radius:16px;">
				<span style="font-size:13px;color:#64748b;">${items.length} ${__("records loaded from database")}</span>
				<button class="btn-b mel-open-filtered-desk-list" data-cid="${cid}" data-doctype="${card_default_doctype}" type="button" style="background:#2563eb;color:#ffffff;border:none;padding:8px 18px;">
					<i class="octicon octicon-filter" style="margin-right:6px;"></i>${__("Open Filtered List View")}
				</button>
			</div>
		`;

		this.$main.find("#mel-modalBody").html(content);
		this.$main.find("#mel-modal").addClass("show");

		// ── Accordion: single-open logic ────────────────────────────────────
		this.$main.find("#mel-collapsible-list").off("click", "[data-row-toggle]").on("click", "[data-row-toggle]", (e) => {
			e.stopPropagation();
			const row_id = $(e.currentTarget).data("row-toggle");
			const $detail = this.$main.find(`#${row_id}-detail`);
			const $icon = this.$main.find(`#${row_id}-icon`);
			const isOpen = $detail.is(":visible");

			// Close all
			this.$main.find(".mel-row-detail").hide();
			this.$main.find(".mel-row-chevron").text("▶");

			// Open clicked if it was closed
			if (!isOpen) {
				$detail.show();
				$icon.text("▼");
			}
		});

		// ── Search filter ────────────────────────────────────────────────────
		this.$main.find("#mel-dialogSearch").off("input").on("input", (e) => {
			const q = $(e.currentTarget).val().toLowerCase();
			this.$main.find(".mel-collapsible-row").each((_, row) => {
				const text = $(row).text().toLowerCase();
				$(row).toggle(text.includes(q));
			});
		});
	}

	open_filtered_desk_list(cid, doctype) {
		const today = frappe.datetime.get_today();
		const filter_map = {
			mr_approved:  { docstatus: 0 },
			po_pending:   { docstatus: 1, material_request_type: "Purchase" },
			subcon_po:    { docstatus: 1 },
			pr_pending: {
				docstatus: 1,
				status: ["not in", ["Completed", "Closed"]],
				per_received: ["<", 100],
			},
			qc_pending:   { docstatus: 0 },
			nc_pending:   { docstatus: 0 },
			overdue_po: {
				docstatus: 1,
				status: ["not in", ["Completed", "Closed", "Delivered", "On Hold"]],
				per_received: ["<", 100],
				schedule_date: ["<=", today],
			},
		};

		const route_options = {
			...(filter_map[cid] || {}),
		};

		frappe.route_options = route_options;
		frappe.set_route("List", doctype);
	}

	// ─── Overdue PO dialog (Pending Orders column) ───────────────────────────
	async open_pending_po_modal(item_name, item_code) {
		const code = item_code || item_name;
		let details = [];
		try {
			details = await this.call("get_pending_po_details", { item_code: code });
		} catch (_e) {}

		let rows_html = "";
		if (details && details.length) {
			details.forEach((d) => {
				const type_cls = d.type === "Subcontracting Order" ? "bdg-indigo" : "bdg-amber";
				const route_doctype = d.type === "Subcontracting Order" ? "Subcontracting Order" : "Purchase Order";
				rows_html += `
					<tr style="cursor:pointer;" onclick="frappe.set_route('Form', '${route_doctype}', '${frappe.utils.escape_html(d.doc)}')">
						<td>
							<a style="font-weight:700;color:#dc2626;text-decoration:underline;" onclick="event.stopPropagation();frappe.set_route('Form', '${route_doctype}', '${frappe.utils.escape_html(d.doc)}')">${frappe.utils.escape_html(d.doc)}</a>
						</td>
						<td><span class="bdg ${type_cls}">${frappe.utils.escape_html(d.type)}</span></td>
						<td>${frappe.utils.escape_html(d.supplier)}</td>
						<td><span class="bdg bdg-rose">${d.qty}</span></td>
						<td>${fmt_date(d.required_date)}</td>
					</tr>
				`;
			});
		} else {
			rows_html = `<tr><td colspan="5" class="text-center text-muted p-4">${__("No overdue pending orders for this item.")}</td></tr>`;
		}

		const total_qty = details.reduce((s, d) => s + (d.qty || 0), 0);

		const content = `
			<div class="modal-head">
				<div>
					<div class="modal-head-title">📦 ${__("Overdue Pending Orders")}: ${frappe.utils.escape_html(item_name)}</div>
					<div class="modal-head-sub">${__("PO & Subcontracting Orders past required date — not yet received")} · ${__("Total")}: <strong>${Math.round(total_qty * 100) / 100}</strong></div>
				</div>
				<button class="btn-x" data-close-modal type="button">✕</button>
			</div>
			<div style="padding:12px 24px 24px 24px;max-height:60vh;overflow-y:auto;">
				<table class="dtable">
					<thead>
						<tr>
							<th>${__("Document")}</th>
							<th>${__("Type")}</th>
							<th>${__("Supplier")}</th>
							<th>${__("Qty Pending")}</th>
							<th>${__("Required Date")}</th>
						</tr>
					</thead>
					<tbody>${rows_html}</tbody>
				</table>
			</div>
		`;
		this.$main.find("#mel-modalBody").html(content);
		this.$main.find("#mel-modal").addClass("show");
	}

	// ─── Export Forecast dialog (Quotations) ─────────────────────────────────
	async open_export_forecast_modal(item_name, item_code) {
		const code = item_code || item_name;
		let quotes = [];
		try {
			quotes = await this.call("get_export_forecast_details", { item_code: code });
		} catch (_e) {}

		let rows_html = "";
		if (quotes && quotes.length) {
			quotes.forEach((q) => {
				rows_html += `
					<tr style="cursor:pointer;" onclick="frappe.set_route('Form', 'Quotation', '${frappe.utils.escape_html(q.quot)}')">
						<td>
							<a style="font-weight:700;color:#0ea5e9;text-decoration:underline;" onclick="event.stopPropagation();frappe.set_route('Form', 'Quotation', '${frappe.utils.escape_html(q.quot)}')">
								${frappe.utils.escape_html(q.quot)}
							</a>
							${q.via ? `<div style="font-size:11px;color:#64748b;">via ${frappe.utils.escape_html(q.via)}</div>` : ""}
						</td>
						<td>${frappe.utils.escape_html(q.party)}</td>
						<td><span class="bdg bdg-cyan">${q.qty} ${frappe.utils.escape_html(q.uom)}</span></td>
						<td>${fmt_date(q.date)}</td>
					</tr>
				`;
			});
		} else {
			rows_html = `<tr><td colspan="4" class="text-center text-muted p-4">${__("No export forecast (Quotations) for this item.")}</td></tr>`;
		}

		const total_qty = quotes.reduce((s, q) => s + (q.qty || 0), 0);

		const content = `
			<div class="modal-head">
				<div>
					<div class="modal-head-title">📈 ${__("Export Forecast")}: ${frappe.utils.escape_html(item_name)}</div>
					<div class="modal-head-sub">${__("Quotations linked to this item")} · ${__("Total")}: <strong>${Math.round(total_qty * 100) / 100}</strong></div>
				</div>
				<div style="display:flex;align-items:center;gap:8px;">
					<button class="btn-b" type="button" onclick="frappe.set_route('List', 'Quotation')">
						${__("Quotation List")}
					</button>
					<button class="btn-x" data-close-modal type="button">✕</button>
				</div>
			</div>
			<div style="padding:24px;max-height:60vh;overflow-y:auto;">
				<table class="dtable">
					<thead>
						<tr>
							<th>${__("Quotation")}</th>
							<th>${__("Party")}</th>
							<th>${__("Quantity")}</th>
							<th>${__("Date")}</th>
						</tr>
					</thead>
					<tbody>
						${rows_html}
					</tbody>
				</table>
			</div>
		`;
		this.$main.find("#mel-modalBody").html(content);
		this.$main.find("#mel-modal").addClass("show");
	}

	// ─── Export Commitment dialog (with date filter) ─────────────────────────
	async open_export_commitment_modal(item_name, item_code, from_date, to_date) {
		const code = item_code || item_name;
		let orders = [];
		try {
			orders = await this.call("get_pending_so_details", { item_code: code, from_date: from_date || "", to_date: to_date || "" });
		} catch (_e) {}

		let rows_html = "";
		if (orders && orders.length) {
			orders.forEach((o) => {
				rows_html += `
					<tr style="cursor:pointer;" onclick="frappe.set_route('Form', 'Sales Order', '${frappe.utils.escape_html(o.so.split(" ")[0])}')">
						<td>
							<a style="font-weight:700;color:#3b82f6;text-decoration:underline;" onclick="event.stopPropagation();frappe.set_route('Form', 'Sales Order', '${frappe.utils.escape_html(o.so.split(" ")[0])}')">
								${frappe.utils.escape_html(o.so)}
							</a>
						</td>
						<td>${frappe.utils.escape_html(o.cust)}</td>
						<td><span class="bdg bdg-amber">${o.qty}</span></td>
						<td>${fmt_date(o.due)}</td>
					</tr>
				`;
			});
		} else {
			rows_html = `<tr><td colspan="4" class="text-center text-muted p-4">${__("No export commitments for this item in the selected date range.")}</td></tr>`;
		}

		const date_range_label = (from_date || to_date)
			? `${from_date ? fmt_date(from_date) : "…"} → ${to_date ? fmt_date(to_date) : "…"}`
			: __("All dates");

		const total_qty = orders.reduce((s, o) => s + (o.qty || 0), 0);

		const content = `
			<div class="modal-head">
				<div>
					<div class="modal-head-title">📊 ${__("Export Commitment")}: ${frappe.utils.escape_html(item_name)}</div>
					<div class="modal-head-sub">${__("Sales Orders linked to this item")} · ${__("Date range")}: <strong>${date_range_label}</strong> · ${__("Total")}: <strong>${Math.round(total_qty * 100) / 100}</strong></div>
				</div>
				<div style="display:flex;align-items:center;gap:8px;">
					<button class="btn-b" type="button" onclick="frappe.set_route('List', 'Sales Order')">
						${__("SO List")}
					</button>
					<button class="btn-x" data-close-modal type="button">✕</button>
				</div>
			</div>
			<div style="padding:24px;max-height:60vh;overflow-y:auto;">
				<table class="dtable">
					<thead>
						<tr>
							<th>${__("Sales Order")}</th>
							<th>${__("Customer")}</th>
							<th>${__("Quantity")}</th>
							<th>${__("Delivery Date")}</th>
						</tr>
					</thead>
					<tbody>${rows_html}</tbody>
				</table>
			</div>
		`;

		this.$main.find("#mel-modalBody").html(content);
		this.$main.find("#mel-modal").addClass("show");
	}

	// ─── Delayed PO drawer (Supplier Performance row) ───────────────────────
	async open_delayed_po_drawer(supplier_name, supplier_code) {
		const supplier_key = supplier_code || supplier_name;
		let details = [];
		try {
			details = await this.call("get_delayed_po_details", { supplier: supplier_key });
		} catch (_e) {}

		let rows_html = "";
		if (details && details.length) {
			details.forEach((p) => {
				rows_html += `
					<tr style="cursor:pointer;" onclick="frappe.set_route('Form', 'Purchase Order', '${frappe.utils.escape_html(p.po)}')">
						<td>
							<a style="font-weight:700;color:#dc2626;text-decoration:underline;" onclick="event.stopPropagation();frappe.set_route('Form', 'Purchase Order', '${frappe.utils.escape_html(p.po)}')">${frappe.utils.escape_html(p.po)}</a>
						</td>
						<td><strong>${frappe.utils.escape_html(p.item)}</strong></td>
						<td>${fmt_date(p.due)}</td>
						<td>${p.received && p.received !== "—" ? fmt_date(p.received) : '<span class="bdg bdg-slate">—</span>'}</td>
						<td><span class="bdg bdg-rose">${frappe.utils.escape_html(p.delay)}</span></td>
						<td><span class="bdg bdg-amber">${frappe.utils.escape_html(p.st)}</span></td>
					</tr>
				`;
			});
		} else {
			rows_html = `<tr><td colspan="6" class="text-center text-muted p-4">${__("No delayed purchase orders for this supplier.")}</td></tr>`;
		}

		const content = `
			<div class="modal-head">
				<div>
					<div class="modal-head-title">${frappe.utils.escape_html(supplier_name)}</div>
					<div class="modal-head-sub">${__("Delayed Purchase Orders Breakdown")}</div>
				</div>
				<div style="display:flex;align-items:center;gap:8px;">
					<button class="btn-b" type="button" onclick="frappe.route_options={'supplier':'${frappe.utils.escape_html(supplier_key)}'};frappe.set_route('List', 'Purchase Order')">
						${__("PO List")}
					</button>
					<button class="btn-x" data-close-modal type="button">✕</button>
				</div>
			</div>
			<div style="padding:12px 24px 24px 24px;max-height:60vh;overflow-y:auto;">
				<table class="dtable">
					<thead>
						<tr>
							<th>${__("PO")}</th>
							<th>${__("Item")}</th>
							<th>${__("Required Date")}</th>
							<th>${__("Received Date")}</th>
							<th>${__("Delay")}</th>
							<th>${__("Status")}</th>
						</tr>
					</thead>
					<tbody>${rows_html}</tbody>
				</table>
			</div>
		`;
		this.$main.find("#mel-modalBody").html(content);
		this.$main.find("#mel-modal").addClass("show");
	}

	close_modal() {
		this.$main.find("#mel-modal").removeClass("show");
	}

	toast(msg) {
		const $box = this.$main.find("#mel-toasts");
		const $t = $(`<div class="toast-msg">${frappe.utils.escape_html(msg)}</div>`).appendTo($box);
		setTimeout(() => $t.remove(), 2600);
	}

	export_stock_csv() {
		if (!this.stock_data.length) {
			this.toast(__("No stock records to export."));
			return;
		}
		const headers = ["Item Name", "JPC", "Valuation Rate", "Total Stock", "Pending PO Qty", "Export Commitment", "Export Forecast"];
		const rows = this.stock_data.map((i) => [i.item, i.jpc, i.rate, i.stock, i.pending_po_qty || 0, i.export, i.export_forecast]);
		const csv = [headers, ...rows].map((r) => r.map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
		const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `stock_overview_${frappe.datetime.get_today()}.csv`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
		this.toast(__("Stock Overview CSV exported."));
	}
}