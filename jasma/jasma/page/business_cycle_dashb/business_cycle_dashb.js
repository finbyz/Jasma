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



class MELBusinessCycleDashboard {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Business Cycle Dashboard"),
			single_column: true,
		});
		this.api = "jasma.jasma.page.business_cycle_dashb.business_cycle_dashb";
		this.cycle = "sales";
		this.data = null;
		this.current_stage = null;
		this.current_records = [];
		this.controls = {};
		this.loading = false;
		this.refresh_timer = null;
		this.search_timer = null;
		this.suppress_filter_refresh = true;

		this.build();
		this.suppress_filter_refresh = false;
		this.bind_events();
		this.configure_page_actions();
		this.refresh();
	}

	build() {
		this.$main = $(`
			<div class="mel-cycle-dashboard">
				<section class="mel-cycle-hero">
					<div>
						<div class="mel-cycle-eyebrow">${__("ERPNext Live Flow")}</div>
						<h2>${__("Sales, Purchase & Subcontracting")}</h2>
						<p>${__(
							"Follow every document from its source to completion, then open the native List or current Form."
						)}</p>
					</div>
					<div class="mel-cycle-live">
						<span class="mel-live-dot"></span>
						<span>${__("Live ERPNext data")}</span>
					</div>
				</section>

				<section class="mel-cycle-toolbar">
					<div class="mel-cycle-tabs" role="tablist">
						<button class="mel-cycle-tab is-active" data-cycle="sales" type="button">
							${__("Sales Cycle")}
						</button>
						<button class="mel-cycle-tab" data-cycle="purchase" type="button">
							${__("Purchase Cycle")}
						</button>
						<button class="mel-cycle-tab" data-cycle="subcontracting" type="button">
							${__("Subcontracting")}
						</button>
					</div>
					<div class="mel-filter-grid">
						<div class="mel-filter-control" data-filter="company"></div>
						<div class="mel-filter-control" data-filter="from_date"></div>
						<div class="mel-filter-control" data-filter="to_date"></div>
						<div class="mel-filter-control" data-filter="party"></div>
						<button class="btn btn-default mel-clear-filters" type="button">
							${__("Clear")}
						</button>
					</div>
				</section>

				<div class="mel-dashboard-alert" hidden></div>
				<div class="mel-dashboard-loading" hidden>
					<div class="mel-loading-line"></div>
					<div class="mel-loading-grid">
						<div></div><div></div><div></div><div></div>
					</div>
				</div>

				<div class="mel-dashboard-content">
					<section class="mel-summary-grid"></section>

					<section class="mel-cycle-section">
						<div class="mel-section-heading">
							<div>
								<h3 class="mel-flow-title">${__("Document Flow")}</h3>
								<p class="mel-flow-description"></p>
							</div>
							<div class="mel-as-of"></div>
						</div>
						<div class="mel-flow-scroll">
							<div class="mel-flow-grid"></div>
						</div>
					</section>

					<section class="mel-cycle-section mel-records-section">
						<div class="mel-section-heading mel-records-heading">
							<div>
								<div class="mel-heading-row">
									<h3 class="mel-records-title">${__("Current Stage")}</h3>
									<span class="mel-record-count">0</span>
								</div>
								<p>${__("Click a document to inspect its current data and connected records.")}</p>
							</div>
							<div class="mel-record-actions">
								<div class="mel-record-search">
									<svg class="icon icon-sm" aria-hidden="true">
										<use href="#icon-search"></use>
									</svg>
									<input type="search" placeholder="${__("Search current stage")}">
								</div>
								<button class="btn btn-default mel-export-stage" type="button">
									${__("Export CSV")}
								</button>
								<button class="btn btn-primary mel-open-list" type="button">
									${__("List View")}
								</button>
							</div>
						</div>
						<div class="mel-stage-table-wrap">
							<table class="mel-stage-table">
								<thead>
									<tr>
										<th>${__("Date")}</th>
										<th>${__("Document")}</th>
										<th>${__("Party / Title")}</th>
										<th>${__("Status")}</th>
										<th>${__("Amount")}</th>
										<th>${__("Due Date")}</th>
										<th class="mel-actions-column">${__("Actions")}</th>
									</tr>
								</thead>
								<tbody></tbody>
							</table>
							<div class="mel-stage-empty" hidden></div>
						</div>
					</section>
				</div>

				<div class="mel-doc-backdrop" data-drawer-close hidden></div>
				<aside class="mel-doc-drawer" aria-hidden="true">
					<div class="mel-doc-drawer-body"></div>
				</aside>
			</div>
		`).appendTo(this.page.main);

		this.$content = this.$main.find(".mel-dashboard-content");
		this.$loading = this.$main.find(".mel-dashboard-loading");
		this.$alert = this.$main.find(".mel-dashboard-alert");
		this.$summary = this.$main.find(".mel-summary-grid");
		this.$flow = this.$main.find(".mel-flow-grid");
		this.$table_body = this.$main.find(".mel-stage-table tbody");
		this.$empty = this.$main.find(".mel-stage-empty");
		this.$drawer = this.$main.find(".mel-doc-drawer");
		this.$drawer_body = this.$main.find(".mel-doc-drawer-body");
		this.$backdrop = this.$main.find(".mel-doc-backdrop");
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
		this.make_party_control();
	}

	make_control(slot, df) {
		const parent = this.$main.find(`[data-filter="${slot}"]`).empty();
		const control = frappe.ui.form.make_control({
			parent,
			df: {
				...df,
				onchange: () => {
					if (!this.suppress_filter_refresh) this.queue_refresh();
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

	make_party_control() {
		const previous = this.controls.party ? this.controls.party.get_value() : "";
		const is_sales = this.cycle === "sales";
		this.controls.party = this.make_control("party", {
			fieldtype: "Link",
			options: is_sales ? "Customer" : "Supplier",
			label: is_sales ? __("Customer") : __("Supplier"),
		});
		if (previous) {
			this.controls.party.set_value("");
		}
	}

	configure_page_actions() {
		this.page.set_primary_action(__("Refresh"), () => this.refresh(), "refresh");
		this.page.add_menu_item(__("Export Current Stage"), () => this.export_current_stage());
		this.page.add_menu_item(__("Open Selected List"), () => this.open_list());
	}

	bind_events() {
		this.$main.on("click", "[data-cycle]", (event) => {
			const cycle = $(event.currentTarget).data("cycle");
			if (cycle === this.cycle) return;
			this.cycle = cycle;
			this.current_stage = null;
			this.current_records = [];
			this.$main.find("[data-cycle]").removeClass("is-active");
			$(event.currentTarget).addClass("is-active");
			this.make_party_control();
			this.close_drawer();
			this.refresh();
		});

		this.$main.on("click", ".mel-clear-filters", () => this.clear_filters());
		this.$main.on("click", ".mel-open-list", () => this.open_list());
		this.$main.on("click", ".mel-export-stage", () => this.export_current_stage());

		this.$main.on("click", ".mel-stage-card", (event) => {
			if ($(event.target).closest("[data-stage-list]").length) return;
			const doctype = $(event.currentTarget).data("doctype");
			const disabled = $(event.currentTarget).attr("aria-disabled") === "true";
			if (!disabled) this.load_stage(doctype);
		});

		this.$main.on("click", "[data-stage-list]", (event) => {
			event.stopPropagation();
			this.open_list($(event.currentTarget).data("stage-list"));
		});

		this.$main.on("click", "[data-doc-preview]", (event) => {
			const $target = $(event.currentTarget);
			this.open_document_preview($target.data("doctype"), $target.data("doc-preview"));
		});

		this.$main.on("click", "[data-doc-open]", (event) => {
			const $target = $(event.currentTarget);
			this.open_form($target.data("doctype"), $target.data("doc-open"));
		});

		this.$main.on("click", "[data-linked-doctype]", (event) => {
			const $target = $(event.currentTarget);
			this.open_form($target.data("linked-doctype"), $target.data("linked-name"));
		});

		this.$main.on("click", "[data-drawer-close]", () => this.close_drawer());

		this.$main.find(".mel-record-search input").on("input", (event) => {
			clearTimeout(this.search_timer);
			this.search_timer = setTimeout(() => {
				if (this.current_stage) {
					this.load_stage(this.current_stage.doctype, $(event.currentTarget).val());
				}
			}, 350);
		});

		$(document).on("keydown.mel-business-cycle-dashboard", (event) => {
			if (event.key === "Escape") this.close_drawer();
		});
	}

	queue_refresh() {
		clearTimeout(this.refresh_timer);
		this.refresh_timer = setTimeout(() => this.refresh(), 300);
	}

	get_filters() {
		return {
			company: this.controls.company?.get_value() || "",
			from_date: this.controls.from_date?.get_value() || "",
			to_date: this.controls.to_date?.get_value() || "",
			party: this.controls.party?.get_value() || "",
		};
	}

	clear_filters() {
		this.suppress_filter_refresh = true;
		this.controls.company.set_value(frappe.defaults.get_user_default("Company") || "");
		this.controls.from_date.set_value("");
		this.controls.to_date.set_value("");
		this.controls.party.set_value("");
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
		this.set_loading(true);
		this.hide_alert();

		try {
			const data = await this.call("get_dashboard", {
				cycle: this.cycle,
				...this.get_filters(),
			});
			this.data = data;
			this.render_dashboard();
		} catch (error) {
			this.show_alert(
				error?.message || __("Could not load the business-cycle dashboard."),
				"danger"
			);
		} finally {
			this.loading = false;
			this.set_loading(false);
		}
	}

	set_loading(is_loading) {
		this.$loading.prop("hidden", !is_loading);
		this.$content.toggleClass("is-loading", is_loading);
	}

	show_alert(message, tone = "warning") {
		this.$alert
			.removeClass("is-warning is-danger")
			.addClass(`is-${tone}`)
			.text(message)
			.prop("hidden", false);
	}

	hide_alert() {
		this.$alert.prop("hidden", true).text("");
	}

	render_dashboard() {
		this.$main.find(".mel-flow-title").text(this.data.label);
		this.$main.find(".mel-flow-description").text(this.data.description);
		this.$main
			.find(".mel-as-of")
			.text(`${__("As of")} ${this.format_date(this.data.as_of)}`);
		this.render_summary();

		let stage = null;
		if (this.current_stage) {
			stage = this.data.stages.find(
				(item) => item.doctype === this.current_stage.doctype && item.can_read
			);
		}
		if (!stage) {
			stage = this.data.stages.find((item) => item.can_read);
		}
		this.current_stage = stage || null;
		this.current_records = stage?.records || [];
		this.render_flow();
		this.render_stage_table();
	}

	render_summary() {
		const cards = [
			{
				label: __("Available Steps"),
				value: this.data.summary.available_steps,
				note: __("on this site"),
				tone: "slate",
			},
			{
				label: __("Documents"),
				value: this.data.summary.documents,
				note: __("in selected period"),
				tone: "blue",
			},
			{
				label: __("Draft"),
				value: this.data.summary.drafts,
				note: __("needs action"),
				tone: "amber",
			},
			{
				label: __("Submitted"),
				value: this.data.summary.submitted,
				note: __("confirmed records"),
				tone: "green",
			},
		];

		this.$summary.html(
			cards
				.map(
					(card) => `
						<article class="mel-summary-card is-${card.tone}">
							<div class="mel-summary-label">${this.escape(card.label)}</div>
							<div class="mel-summary-value">${this.number(card.value)}</div>
							<div class="mel-summary-note">${this.escape(card.note)}</div>
						</article>
					`
				)
				.join("")
		);
	}

	render_flow() {
		this.$flow.html(
			this.data.stages
				.map((stage, index) => {
					const disabled = !stage.available || !stage.can_read;
					const active = this.current_stage?.doctype === stage.doctype;
					const reason = disabled ? stage.reason : __("Load current records");
					return `
						<article
							class="mel-stage-card ${active ? "is-active" : ""} ${
								disabled ? "is-disabled" : ""
							}"
							data-doctype="${this.escape(stage.doctype)}"
							aria-disabled="${disabled ? "true" : "false"}"
							title="${this.escape(reason || "")}"
						>
							<div class="mel-stage-top">
								<span class="mel-stage-index">${String(index + 1).padStart(2, "0")}</span>
								<button
									class="mel-stage-list"
									type="button"
									data-stage-list="${this.escape(stage.doctype)}"
									${disabled ? "disabled" : ""}
								>
									${__("List")}
								</button>
							</div>
							<div class="mel-stage-count">${disabled ? "—" : this.number(stage.count)}</div>
							<div class="mel-stage-label">${this.escape(stage.label)}</div>
							<div class="mel-stage-meta">
								${
									disabled
										? this.escape(stage.available ? __("No permission") : __("Not installed"))
										: stage.is_submittable
										? `${this.number(stage.draft_count)} ${__("draft")} · ${this.number(
												stage.submitted_count
										  )} ${__("submitted")}`
										: `${this.number(stage.count)} ${__("records")}`
								}
							</div>
						</article>
					`;
				})
				.join("")
		);
	}

	async load_stage(doctype, search = "") {
		const stage = this.data?.stages.find((item) => item.doctype === doctype);
		if (!stage || !stage.can_read) return;

		this.current_stage = stage;
		this.$flow.find(".mel-stage-card").removeClass("is-active");
		this.$flow
			.find(`.mel-stage-card[data-doctype="${this.selector_escape(doctype)}"]`)
			.addClass("is-active");
		this.render_table_loading(stage.label);

		try {
			const result = await this.call("get_stage_records", {
				cycle: this.cycle,
				doctype,
				search,
				limit: 100,
				...this.get_filters(),
			});
			this.current_records = result.records || [];
			this.current_stage = {
				...stage,
				count: result.count,
				date_field: result.date_field,
			};
			this.render_stage_table();
		} catch (error) {
			this.show_alert(error?.message || __("Could not load the selected stage."), "danger");
			this.current_records = [];
			this.render_stage_table();
		}
	}

	render_table_loading(label) {
		this.$main.find(".mel-records-title").text(label);
		this.$main.find(".mel-record-count").text(__("Loading"));
		this.$empty.prop("hidden", true);
		this.$table_body.html(
			`<tr><td colspan="7"><div class="mel-table-loading">${__("Loading live records…")}</div></td></tr>`
		);
	}

	render_stage_table() {
		const stage = this.current_stage;
		if (!stage) {
			this.$main.find(".mel-records-title").text(__("No readable stage"));
			this.$main.find(".mel-record-count").text("0");
			this.$table_body.empty();
			this.show_table_empty(__("No cycle DocTypes are available with your current permissions."));
			return;
		}

		this.$main.find(".mel-records-title").text(stage.label);
		this.$main.find(".mel-record-count").text(this.number(stage.count));
		this.$main.find(".mel-open-list").prop("disabled", !stage.can_read);
		this.$main.find(".mel-export-stage").prop("disabled", !this.current_records.length);

		if (!this.current_records.length) {
			this.$table_body.empty();
			this.show_table_empty(__("No documents match the selected filters."));
			return;
		}

		this.$empty.prop("hidden", true);
		this.$table_body.html(
			this.current_records
				.map(
					(record) => `
						<tr>
							<td class="mel-date-cell">${this.escape(this.format_date(record.date))}</td>
							<td>
								<button
									class="mel-doc-link"
									type="button"
									data-doc-preview="${this.escape(record.name)}"
									data-doctype="${this.escape(record.doctype)}"
								>
									${this.escape(record.name)}
								</button>
								<div class="mel-doc-type">${this.escape(record.doctype)}</div>
							</td>
							<td>
								<div class="mel-party-name">${this.escape(record.party || record.title || "—")}</div>
								${record.project ? `<div class="mel-project">${this.escape(record.project)}</div>` : ""}
							</td>
							<td>${this.status_badge(record.status, record.docstatus)}</td>
							<td class="mel-amount-cell">${this.format_amount(
								record.amount,
								record.currency
							)}</td>
							<td class="mel-date-cell">${this.escape(this.format_date(record.due_date))}</td>
							<td>
								<div class="mel-row-actions">
									<button
										class="btn btn-xs btn-default"
										type="button"
										data-doc-preview="${this.escape(record.name)}"
										data-doctype="${this.escape(record.doctype)}"
									>
										${__("Preview")}
									</button>
									<button
										class="btn btn-xs btn-default"
										type="button"
										data-doc-open="${this.escape(record.name)}"
										data-doctype="${this.escape(record.doctype)}"
									>
										${__("Open")}
									</button>
								</div>
							</td>
						</tr>
					`
				)
				.join("")
		);
	}

	show_table_empty(message) {
		this.$empty.text(message).prop("hidden", false);
	}

	async open_document_preview(doctype, name) {
		this.open_drawer();
		this.$drawer_body.html(`
			<div class="mel-drawer-loading">
				<div class="mel-spinner"></div>
				<div>${__("Loading current document…")}</div>
			</div>
		`);

		try {
			const doc = await this.call("get_document_preview", { doctype, name });
			this.render_document_preview(doc);
		} catch (error) {
			this.$drawer_body.html(`
				<div class="mel-drawer-error">
					<h4>${__("Unable to open preview")}</h4>
					<p>${this.escape(error?.message || __("The document could not be loaded."))}</p>
					<button class="btn btn-default" type="button" data-drawer-close>${__("Close")}</button>
				</div>
			`);
		}
	}

	render_document_preview(doc) {
		const fields = (doc.fields || [])
			.map(
				(field) => `
					<div class="mel-preview-field">
						<div class="mel-preview-label">${this.escape(field.label)}</div>
						<div class="mel-preview-value">
							${this.format_field_value(field)}
						</div>
					</div>
				`
			)
			.join("");

		const items = doc.items ? this.render_items_preview(doc.items) : "";
		const connections = (doc.connections || []).length
			? `
				<section class="mel-preview-section">
					<div class="mel-preview-section-title">
						${__("Connected Documents")}
						<span>${this.number(doc.connections.length)}</span>
					</div>
					<div class="mel-connection-grid">
						${doc.connections
							.map(
								(link) => `
									<button
										class="mel-connection-card"
										type="button"
										data-linked-doctype="${this.escape(link.doctype)}"
										data-linked-name="${this.escape(link.name)}"
									>
										<span>${this.escape(link.doctype)}</span>
										<strong>${this.escape(link.name)}</strong>
									</button>
								`
							)
							.join("")}
					</div>
				</section>
			`
			: `
				<section class="mel-preview-section">
					<div class="mel-preview-section-title">${__("Connected Documents")}</div>
					<div class="mel-preview-empty">${__("No directly linked cycle document was found.")}</div>
				</section>
			`;

		this.$drawer_body.html(`
			<header class="mel-preview-header">
				<div>
					<div class="mel-preview-doctype">${this.escape(doc.doctype)}</div>
					<h3>${this.escape(doc.name)}</h3>
					<div class="mel-preview-title">${this.escape(doc.title || doc.name)}</div>
				</div>
				<button class="mel-drawer-close" type="button" data-drawer-close aria-label="${__("Close")}">
					<svg class="icon icon-lg" aria-hidden="true"><use href="#icon-close"></use></svg>
				</button>
			</header>

			<div class="mel-preview-actions">
				<button
					class="btn btn-primary"
					type="button"
					data-doc-open="${this.escape(doc.name)}"
					data-doctype="${this.escape(doc.doctype)}"
				>
					${__("Open Full Form")}
				</button>
				<button
					class="btn btn-default"
					type="button"
					data-stage-list="${this.escape(doc.doctype)}"
				>
					${__("List View")}
				</button>
			</div>

			<section class="mel-preview-section">
				<div class="mel-preview-section-title">${__("Current Document")}</div>
				<div class="mel-preview-fields">
					${fields || `<div class="mel-preview-empty">${__("No summary fields available.")}</div>`}
				</div>
			</section>

			${items}
			${connections}

			<section class="mel-preview-section">
				<div class="mel-preview-section-title">${__("Audit Trail")}</div>
				<div class="mel-audit-grid">
					<div><span>${__("Created By")}</span><strong>${this.escape(
						doc.audit?.owner || "—"
					)}</strong><small>${this.escape(this.format_datetime(doc.audit?.creation))}</small></div>
					<div><span>${__("Modified By")}</span><strong>${this.escape(
						doc.audit?.modified_by || "—"
					)}</strong><small>${this.escape(this.format_datetime(doc.audit?.modified))}</small></div>
				</div>
			</section>
		`);
	}

	render_items_preview(items) {
		const columns = items.columns || [];
		const rows = items.rows || [];
		if (!columns.length || !rows.length) return "";

		return `
			<section class="mel-preview-section">
				<div class="mel-preview-section-title">
					${__("Items")}
					<span>${this.number(items.total_rows)}</span>
				</div>
				<div class="mel-items-table-wrap">
					<table class="mel-items-table">
						<thead>
							<tr>${columns.map((column) => `<th>${this.escape(column.label)}</th>`).join("")}</tr>
						</thead>
						<tbody>
							${rows
								.map(
									(row) => `
										<tr>
											${columns
												.map(
													(column) =>
														`<td>${this.escape(
															this.simple_value(row[column.fieldname], column.fieldtype)
														)}</td>`
												)
												.join("")}
										</tr>
									`
								)
								.join("")}
						</tbody>
					</table>
				</div>
				${
					items.total_rows > rows.length
						? `<div class="mel-items-note">${__(
								"Showing first {0} of {1} rows",
								[rows.length, items.total_rows]
						  )}</div>`
						: ""
				}
			</section>
		`;
	}

	format_field_value(field) {
		if (field.fieldtype === "Link" && field.options && field.value) {
			return `
				<button
					class="mel-inline-link"
					type="button"
					data-linked-doctype="${this.escape(field.options)}"
					data-linked-name="${this.escape(field.value)}"
				>
					${this.escape(field.value)}
				</button>
			`;
		}
		if (field.fieldtype === "Currency") {
			return this.format_amount(field.value);
		}
		return this.escape(this.simple_value(field.value, field.fieldtype));
	}

	simple_value(value, fieldtype) {
		if (value === null || value === undefined || value === "") return "—";
		if (fieldtype === "Date") return this.format_date(value);
		if (fieldtype === "Datetime") return this.format_datetime(value);
		if (fieldtype === "Check") return Number(value) ? __("Yes") : __("No");
		if (["Float", "Currency", "Percent"].includes(fieldtype)) {
			return format_number(value, null, 2);
		}
		return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
	}

	open_drawer() {
		this.$backdrop.prop("hidden", false);
		this.$drawer.addClass("is-open").attr("aria-hidden", "false");
		$("body").addClass("mel-drawer-open");
	}

	close_drawer() {
		this.$backdrop.prop("hidden", true);
		this.$drawer.removeClass("is-open").attr("aria-hidden", "true");
		$("body").removeClass("mel-drawer-open");
	}

	open_list(doctype = null) {
		const stage =
			this.data?.stages.find((item) => item.doctype === doctype) || this.current_stage;
		if (!stage?.can_read) return;

		const filters = this.get_filters();
		const route_options = {};
		if (filters.company) route_options.company = filters.company;
		if (stage.date_field && filters.from_date && filters.to_date) {
			route_options[stage.date_field] = ["between", [filters.from_date, filters.to_date]];
		} else if (stage.date_field && filters.from_date) {
			route_options[stage.date_field] = [">=", filters.from_date];
		} else if (stage.date_field && filters.to_date) {
			route_options[stage.date_field] = ["<=", filters.to_date];
		}
		if (this.cycle === "subcontracting" && stage.doctype === "Purchase Order") {
			route_options.is_subcontracted = 1;
		}
		if (this.cycle === "subcontracting" && stage.doctype === "Stock Entry") {
			route_options.stock_entry_type = "Send to Subcontractor";
		}
		if (this.cycle === "purchase" && stage.doctype === "Purchase Order") {
			route_options.is_subcontracted = 0;
		}

		frappe.route_options = route_options;
		frappe.set_route("List", stage.doctype, "List");
	}

	open_form(doctype, name) {
		if (!doctype || !name) return;
		frappe.set_route("Form", doctype, name);
	}

	export_current_stage() {
		if (!this.current_stage || !this.current_records.length) {
			frappe.show_alert({ message: __("No records to export."), indicator: "orange" });
			return;
		}
		const headers = [
			"Date",
			"DocType",
			"Document",
			"Party / Title",
			"Status",
			"Amount",
			"Currency",
			"Due Date",
			"Project",
		];
		const rows = this.current_records.map((record) => [
			record.date || "",
			record.doctype || "",
			record.name || "",
			record.party || record.title || "",
			record.status || "",
			record.amount ?? "",
			record.currency || "",
			record.due_date || "",
			record.project || "",
		]);
		const csv = [headers, ...rows]
			.map((row) => row.map((value) => this.csv_cell(value)).join(","))
			.join("\r\n");
		const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${frappe.scrub(this.current_stage.doctype)}_${frappe.datetime.get_today()}.csv`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
		frappe.show_alert({ message: __("CSV exported."), indicator: "green" });
	}

	csv_cell(value) {
		return `"${String(value ?? "").replace(/"/g, '""')}"`;
	}

	status_badge(status, docstatus) {
		const value = status || { 0: __("Draft"), 1: __("Submitted"), 2: __("Cancelled") }[docstatus];
		const normalized = String(value || "").toLowerCase();
		let tone = "gray";
		if (
			["submitted", "completed", "paid", "delivered", "approved", "active", "closed"].some(
				(term) => normalized.includes(term)
			)
		) {
			tone = "green";
		} else if (
			["cancelled", "rejected", "overdue", "failed", "stopped"].some((term) =>
				normalized.includes(term)
			)
		) {
			tone = "red";
		} else if (
			["draft", "pending", "open", "partly", "partial", "to "].some((term) =>
				normalized.includes(term)
			)
		) {
			tone = "amber";
		}
		return `<span class="mel-status is-${tone}">${this.escape(value || "—")}</span>`;
	}

	format_amount(value, currency = null) {
		if (value === null || value === undefined || value === "") return "—";
		return this.escape(format_currency(value, currency || undefined));
	}

	format_date(value) {
		if (!value) return "—";
		try {
			return frappe.datetime.str_to_user(String(value).slice(0, 10));
		} catch (_error) {
			return String(value);
		}
	}

	format_datetime(value) {
		if (!value) return "—";
		try {
			return frappe.datetime.str_to_user(value);
		} catch (_error) {
			return String(value);
		}
	}

	number(value) {
		return Number(value || 0).toLocaleString();
	}

	escape(value) {
		return frappe.utils.escape_html(String(value ?? ""));
	}

	selector_escape(value) {
		if (window.CSS?.escape) return CSS.escape(value);
		return String(value).replace(/(["\\])/g, "\\$1");
	}
}
