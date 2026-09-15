// ---------------------------------------------------------------------------
// AO TRACKER — frontend
//
// "AO Number" = Project. Tab 1 lists every Project in range with its linked
// MR / PO / DN / SI status pulled live via ao_tracker.get_ao_list. Tab 2
// drills into one Project's full document trail via ao_tracker.get_ao_detail.
//
// Drop at: <app>/<app>/page/ao_tracker/ao_tracker.js
// Page route: /app/ao-tracker  (page name must be "ao-tracker")
//
// CHANGELOG (this revision):
//   - REMOVED: the "Stage" dot-and-connector timeline column and the
//     "Severity" badge column (both driven by project age) are gone.
//   - NEW: replaced them with a single "Priority" column. Priority is
//     derived from how many days remain between the linked Sales Order's
//     Delivery Date and today:
//       > 60 days left   -> Low
//       31-60 days left  -> Medium
//       16-30 days left  -> High
//       1-15 days left   -> Urgent
//       <= 0 days left   -> Overdue
//     Once a Delivery Note already exists for the project it's considered
//     fulfilled and always shows Low, regardless of date. Computed
//     server-side in get_ao_list (see ao_tracker.py::determine_priority).
//   - NEW: "Purchase Invoice" name + status columns added right beside
//     "Purchase Receipt" in the list grid.
//   - FIXED: every "—" placeholder shown when a value is missing (Sales
//     Order, Pending At, per-doc-type cells, the doc preview modal's
//     Reference AO stat) has been replaced with a blank cell instead of a
//     dash character.
//
// --- Everything below this point is unchanged from the previous revision
//     except where noted inline, which fixed issues found against the
//     wireframe:
//   - FIXED: the MR/PO/DN/SI status pills in the list table looked like
//     links but had no click handler at all, and didn't carry a doctype —
//     so nothing happened when clicked. They now navigate correctly.
//   - Added the "Status Overview / Detailed View" segmented toggle instead
//     of only a text "back" link.
//   - Clicking a document card in the "Linked documents" grid now opens a
//     lightweight preview modal (status, items, links) before jumping to
//     the full form, instead of navigating away immediately.
//   - Document cards now show a count badge, and cards for doc types that
//     aren't installed/queryable on this site say "Not applicable" instead
//     of "Not generated" (so it doesn't read as a bug).
//   - "Order items" and "Material consumption" are merged into one
//     FG → RM breakdown table, matching the wireframe.
//   - Panels are collapsible (click the header).
//   - Row checkboxes added to the list view for future bulk actions.
//   - Light/Dark mode toggle (icon button in the topbar), persisted
//     via localStorage, same pattern as the Executive Dashboard. Every
//     color in this page is already driven by CSS variables on
//     `.ao-tracker-wrap`, so dark mode is just a second variable set
//     applied via `.ao-tracker-wrap[data-theme="dark"]` — no markup or
//     data logic was touched.
//   - NEW: "Sales Order" column widened so SO numbers no longer clip.
//   - NEW: removed the grey vertical divider line that used to run down
//     every row between column groups (MR|PO|SCO|...) — the colored bar
//     under each group heading is enough of a separator on its own.
//   - NEW: when a project has MORE THAN ONE document of a given type
//     (e.g. 2 Sales Invoices), the cell now shows a "N Sales Invoices"
//     chip instead of silently only showing the latest one. Clicking the
//     chip opens a list so the user can go through each document one by
//     one (each row opens the existing preview modal).
//   - NEW: the From/To date inputs are replaced with a period dropdown
//     (This Financial Year / Previous Financial Year / Quarterly (Last 3
//     Months) / Monthly / Weekly / Custom Range), matching the standard
//     ERPNext dashboard date-range picker. Defaults to "Monthly". Picking
//     "Custom Range" reveals editable From/To date boxes; every other
//     option computes and displays the range automatically and refreshes
//     the list immediately.
//   - NEW: "AO / Project" and "Sales Order" filters are now real Frappe
//     Link fields (with the standard search-as-you-type dropdown) instead
//     of plain text boxes, so you pick an existing Project / Sales Order
//     instead of typing a fragment to match against.
// ---------------------------------------------------------------------------

frappe.pages['ao-tracker'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'AO Tracker',
		single_column: true
	});

	new AOTracker(page, wrapper);
};

class AOTracker {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		this.method = {
			list: 'jasma.jasma.page.ao_tracker.ao_tracker.get_ao_list',
			detail: 'jasma.jasma.page.ao_tracker.ao_tracker.get_ao_detail',
			doc_summary: 'jasma.jasma.page.ao_tracker.ao_tracker.get_doc_summary',
			// NEW: powers the "N Sales Invoices" chip -> list -> pick one -> preview flow.
			doc_list: 'jasma.jasma.page.ao_tracker.ao_tracker.get_doc_list'
		};
		// If your app name isn't "jasma", update the dotted paths above to
		// "<your_app>.<your_app>.page.ao_tracker.ao_tracker.<method>"

		this.state = {
			list: [], currentAo: null, activeTab: 1, selected: new Set(),
			// persisted theme, same key style/pattern as the
			// Executive Dashboard ("exd_theme" -> "aot_theme").
			theme: localStorage.getItem('aot_theme') || 'light',
			// NEW: which date-range preset is active. Defaults to Monthly.
			period: 'monthly'
		};

		// Labels + menu order for the period dropdown.
		this.period_options = [
			{ value: 'fy_current', label: __('This Financial Year') },
			{ value: 'fy_previous', label: __('Previous Financial Year') },
			{ value: 'quarterly', label: __('Quarterly (Last 3 Months)') },
			{ value: 'monthly', label: __('Monthly') },
			{ value: 'weekly', label: __('Weekly') },
			{ value: 'custom', label: __('Custom Range') }
		];

		// Full color key for every doc type in the Tab 2 catalog (superset
		// of doc_columns above, which only covers the list-view subset).
		this.doc_type_colors = {
			quote: '#F59E0B', so: '#2563EB', mr: '#7C3AED', po: '#0284C7',
			sco: '#0D9488', scr: '#D97706', pr: '#E11D48', sr: '#65A30D',
			qc: '#9333EA', nc: '#DC2626', pi: '#EA580C', dn: '#059669',
			si: '#C026D3', pe_in: '#16A34A', pe_out: '#DB2777', je: '#475569'
		};

		// Column + color key for the procurement trail shown on the list
		// grid. Each key must match a `docs` key returned by get_ao_list.
		// NEW: "Purchase Invoice" (pi) added right beside "Purchase
		// Receipt" (pr), matching the requested layout.
		this.doc_columns = [
			{ key: 'mr', label: 'MR', full_label: 'Material Requests', color: '#7C3AED' },
			{ key: 'po', label: 'PO', full_label: 'Purchase Orders', color: '#0284C7' },
			{ key: 'sco', label: 'Subcontracting Order', full_label: 'Subcontracting Orders', color: '#0D9488' },
			{ key: 'scr', label: 'Subcontracting Receipt', full_label: 'Subcontracting Receipts', color: '#D97706' },
			{ key: 'pr', label: 'Purchase Receipt', full_label: 'Purchase Receipts', color: '#E11D48' },
			{ key: 'pi', label: 'Purchase Invoice', full_label: 'Purchase Invoices', color: '#EA580C' },
			{ key: 'dn', label: 'Delivery Note', full_label: 'Delivery Notes', color: '#059669' },
			{ key: 'si', label: 'Sales Invoice', full_label: 'Sales Invoices', color: '#C026D3' }
		];

		this.setup_actions();
		this.render_shell();
		this.bind_events();
		this.load_list();
	}

	setup_actions() {
		// Frappe's own page head (Home / AO Tracker breadcrumb + a black
		// "Refresh" button) rendered on top of our own custom header,
		// which also has an "AO Tracker" title - showing it twice.
		// Our custom header now carries its own Refresh icon button
		// (see bind_events -> .aot-refresh-btn), so the framework bar
		// is no longer needed and is hidden entirely.
		$(this.wrapper).find('.page-head').hide();
	}

	// ---------------------------------------------------------------- shell
	render_shell() {
		this.$wrap = $(`<div class="ao-tracker-wrap">${this.markup()}</div>`);
		$(this.page.body).empty().append(this.$wrap);
		this.render_period_menu();
		this.apply_period('monthly', { silent: true });
		// NEW: Project / Sales Order / Company are real Frappe Link fields
		// now - they need to be created after the wrapper is in the DOM.
		// _initializing suppresses the auto-reload-on-change behaviour
		// while we're only setting default values, not while the user is
		// actually picking something.
		this._initializing = true;
		this.init_link_filters();
		this._initializing = false;
		// paint the persisted theme onto the wrapper as soon as it
		// exists in the DOM (also fixes the toggle icon/title to match
		// whatever theme was loaded from localStorage).
		this.apply_theme();
	}

	// NEW: "Company", "AO / Project" and "Sales Order" are real Frappe Link
	// controls (search-as-you-type against the real doctype) instead of
	// free-text inputs. Company defaults to the user's/global default
	// company. Every one of them reloads the list on change - there's no
	// separate "Apply filters" button any more, only Reset.
	init_link_filters() {
		this.company_control = frappe.ui.form.make_control({
			parent: this.$wrap.find('.aot-f-company-wrap').get(0),
			df: {
				fieldtype: 'Link',
				options: 'Company',
				fieldname: 'company',
				placeholder: __('All Companies'),
				onchange: () => { if (!this._initializing) this.load_list(); }
			},
			render_input: true
		});
		this.company_control.refresh();
		// Default to the user's default Company, falling back to the
		// site-wide Global Default Company.
		const default_company = frappe.defaults.get_default('company') || frappe.sys_defaults?.company;
		if (default_company) this.company_control.set_value(default_company);

		this.project_control = frappe.ui.form.make_control({
			parent: this.$wrap.find('.aot-f-project-wrap').get(0),
			df: {
				fieldtype: 'Link',
				options: 'Project',
				fieldname: 'project',
				placeholder: __('AO / Project'),
				onchange: () => { if (!this._initializing) this.load_list(); }
			},
			render_input: true
		});
		this.project_control.refresh();

		this.so_control = frappe.ui.form.make_control({
			parent: this.$wrap.find('.aot-f-so-wrap').get(0),
			df: {
				fieldtype: 'Link',
				options: 'Sales Order',
				fieldname: 'sales_order',
				placeholder: __('Sales Order'),
				onchange: () => { if (!this._initializing) this.load_list(); }
			},
			render_input: true
		});
		this.so_control.refresh();
	}

	// ------------------------------------------------------------ period
	render_period_menu() {
		const $menu = this.$wrap.find('.aot-period-menu').empty();
		this.period_options.forEach((opt) => {
			$menu.append(`<div class="aot-period-item" data-period="${opt.value}">${opt.label}</div>`);
		});
	}

	// Computes {from, to} for every preset except "custom" (which leaves
	// whatever the user has typed into the From/To boxes untouched).
	// Fiscal year is assumed to run April -> March; change FY_START_MONTH
	// below if this site's fiscal year starts on a different month.
	compute_period_range(period) {
		const FY_START_MONTH = 4; // April
		const today = frappe.datetime.get_today();

		if (period === 'weekly') {
			return { from: frappe.datetime.add_days(today, -7), to: today };
		}
		if (period === 'monthly') {
			return { from: frappe.datetime.add_months(today, -1), to: today };
		}
		if (period === 'quarterly') {
			return { from: frappe.datetime.add_months(today, -3), to: today };
		}
		if (period === 'fy_current' || period === 'fy_previous') {
			const d = frappe.datetime.str_to_obj(today);
			let fyStartYear = d.getFullYear();
			if ((d.getMonth() + 1) < FY_START_MONTH) fyStartYear -= 1;
			if (period === 'fy_previous') fyStartYear -= 1;
			const pad = (n) => String(n).padStart(2, '0');
			const from = `${fyStartYear}-${pad(FY_START_MONTH)}-01`;
			const nextStart = `${fyStartYear + 1}-${pad(FY_START_MONTH)}-01`;
			return { from, to: frappe.datetime.add_days(nextStart, -1) };
		}
		// custom - leave as-is
		return null;
	}

	// Applies a period preset: updates the button label + active menu item,
	// recomputes/paints the From-To boxes, toggles them read-only (locked
	// for presets, editable for Custom Range), and - unless silenced -
	// reloads the list immediately, the way a dashboard date filter would.
	apply_period(period, opts) {
		opts = opts || {};
		this.state.period = period;

		const chosen = this.period_options.find((o) => o.value === period);
		this.$wrap.find('.aot-period-label').text(chosen ? chosen.label : period);
		this.$wrap.find('.aot-period-item').removeClass('active');
		this.$wrap.find(`.aot-period-item[data-period="${period}"]`).addClass('active');

		const isCustom = period === 'custom';
		this.$wrap.find('.aot-f-from, .aot-f-to').prop('readonly', !isCustom).toggleClass('aot-locked', !isCustom);

		if (!isCustom) {
			const range = this.compute_period_range(period);
			if (range) {
				this.$wrap.find('.aot-f-from').val(range.from);
				this.$wrap.find('.aot-f-to').val(range.to);
			}
		}

		this.$wrap.find('.aot-period-menu').removeClass('open');
		if (!opts.silent) this.load_list();
	}

	// ------------------------------------------------------------- theme
	// Light/Dark mode, mirroring the Executive Dashboard's own
	// applyTheme()/toggleTheme() pair. Every color in this page's CSS is
	// already a variable on `.ao-tracker-wrap`, so toggling theme is just
	// flipping a `data-theme` attribute - a `[data-theme="dark"]` block
	// below re-defines the same variable names with dark values.
	apply_theme() {
		this.$wrap.attr('data-theme', this.state.theme);
		const isDark = this.state.theme === 'dark';
		this.$wrap.find('.aot-theme-toggle')
			.html(this.theme_icon())
			.attr('title', isDark ? __('Switch to Light Mode') : __('Switch to Dark Mode'));
	}

	toggle_theme() {
		this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
		localStorage.setItem('aot_theme', this.state.theme);
		this.apply_theme();
	}

	theme_icon() {
		// sun (shown while in dark mode, to switch back to light)
		if (this.state.theme === 'dark') {
			return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`;
		}
		// moon (shown while in light mode, to switch to dark)
		return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
	}

	// Refresh icon for the header button that replaces Frappe's own
	// primary-action Refresh button (now hidden - see setup_actions()).
	refresh_icon() {
		return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-9-9c2.5 0 4.7 1 6.4 2.6L21 8M21 3v5h-5"/></svg>`;
	}

	// NEW: small line icons for the filter pills, matching the
	// theme/refresh icon style so everything in the bar looks consistent
	// regardless of which icon names happen to exist in this site's
	// frappe.utils.icon sprite sheet.
	home_icon() {
		return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9"/></svg>`;
	}

	calendar_icon() {
		return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="2.2"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>`;
	}

	chevron_icon() {
		return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
	}

	project_icon() {
		return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>`;
	}

	sales_order_icon() {
		return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5h9l3 3V20a1.2 1.2 0 0 1-1.2 1.2H6A1.2 1.2 0 0 1 4.8 20V3.7A1.2 1.2 0 0 1 6 2.5Z"/><path d="M9 9h6M9 13h6M9 17h3.5"/></svg>`;
	}

	markup() {
		return `
		<style>${this.css()}</style>

		<div class="aot-topbar">
			<div class="aot-topbar-title">
				<div class="aot-topbar-badge">AO</div>
				<div>
					<div class="aot-topbar-heading">${__('AO Tracker')}</div>
					<div class="aot-topbar-sub">${__('Advance Order')} \u2192 ${__('Procurement')} \u2192 ${__('Fulfilment')}</div>
				</div>
			</div>
			<div class="aot-topbar-actions">
				<div class="aot-toggle" role="tablist">
					<button class="aot-toggle-btn active" data-goto="1">${__('Status Overview')}</button>
					<button class="aot-toggle-btn" data-goto="2">${__('Detailed View')}</button>
				</div>
				<button class="aot-icon-btn aot-refresh-btn" title="${__('Refresh')}">${this.refresh_icon()}</button>
			</div>
		</div>

		<div class="aot-view aot-view-1 active" data-view="1">
			<div class="aot-filters">
				<div class="aot-pill-field">
					<span class="aot-pill-icon">${this.home_icon()}</span>
					<div class="aot-f-company-wrap aot-pill-input"></div>
				</div>

				<div class="aot-period-dropdown aot-pill-field">
					<button type="button" class="aot-period-btn">
						${this.calendar_icon()}
						<span class="aot-period-label">${__('Monthly')}</span>
						${this.chevron_icon()}
					</button>
					<div class="aot-period-menu"></div>
				</div>

				<div class="aot-daterange-box">
					<input type="date" class="aot-f-from aot-locked" readonly>
				</div>
				<span class="aot-date-sep">${__('to')}</span>
				<div class="aot-daterange-box">
					<input type="date" class="aot-f-to aot-locked" readonly>
				</div>

				<div class="aot-pill-field">
					<span class="aot-pill-icon">${this.project_icon()}</span>
					<div class="aot-f-project-wrap aot-pill-input"></div>
				</div>
				<div class="aot-pill-field">
					<span class="aot-pill-icon">${this.sales_order_icon()}</span>
					<div class="aot-f-so-wrap aot-pill-input"></div>
				</div>

				<div class="aot-filter-actions">
					<button class="btn btn-default btn-sm aot-reset">${__('Reset')}</button>
					<button class="aot-icon-btn aot-theme-toggle" title="${__('Switch to Dark Mode')}">${this.theme_icon()}</button>
				</div>
			</div>

			<div class="aot-section-head">
				<div class="aot-section-title">${__('Advance Orders')}</div>
				<div class="aot-result-count"></div>
			</div>

			<div class="aot-table-scroll">
				<table class="aot-status-table">
					<thead>
						<tr>
							<th style="width:36px;"><input type="checkbox" class="aot-select-all"></th>
							<th>${__('AO Number')}</th>
							<th class="aot-so-col">${__('Sales Order')}</th>
							<th>${__('Customer')}</th>
							<th>${__('Status')}</th>
							${this.doc_columns.map(c => `
								<th class="aot-grp-start" style="border-top:3px solid ${c.color};">${__(c.label)}</th>
								<th>${__(c.label)} ${__('Status')}</th>
							`).join('')}
							<th class="aot-grp-start aot-priority-col">${__('Priority')}</th>
							<th style="width:40px;"></th>
						</tr>
					</thead>
					<tbody class="aot-tbody"></tbody>
				</table>
			</div>
		</div>

		<div class="aot-view aot-view-2" data-view="2">
			<button class="aot-back-link">
				${frappe.utils.icon('left', 'sm')} ${__('Back to status overview')}
			</button>

			<div class="aot-detail-header">
				<div class="aot-detail-title-block">
					<h1 class="aot-d-title"></h1>
					<div class="aot-d-sub"></div>
				</div>
				<div class="aot-mini-pill aot-d-status-pill"></div>
			</div>

			<div class="aot-panel">
				<div class="aot-panel-head aot-collapsible">
					<div class="aot-panel-head-left">
						<div class="aot-panel-title">${__('Project overview')}</div>
						<div class="aot-panel-desc">${__('Estimated revenue, material cost, and profitability for this AO.')}</div>
					</div>
					<span class="aot-caret">${frappe.utils.icon('small-down', 'sm')}</span>
				</div>
				<div class="aot-panel-body">
					<div class="aot-stat-grid aot-overview-grid"></div>
				</div>
			</div>

			<div class="aot-panel">
				<div class="aot-panel-head aot-collapsible">
					<div class="aot-panel-head-left">
						<div class="aot-panel-title">${__('Order items & material consumption')}</div>
						<div class="aot-panel-desc">${__('Every finished item and every raw material / component consumed against it.')}</div>
					</div>
					<span class="aot-caret">${frappe.utils.icon('small-down', 'sm')}</span>
				</div>
				<div class="aot-panel-body">
					<div class="aot-table-x-scroll">
						<table class="aot-flat-table aot-items-table">
							<thead>
								<tr>
									<th>${__('Order Item')}</th>
									<th>${__('Type')}</th>
									<th>${__('Component / RM Consumed')}</th>
									<th class="aot-num">${__('Qty Needed')}</th>
									<th class="aot-num">${__('Total Ordered')}</th>
									<th class="aot-num">${__('Consumed')}</th>
									<th class="aot-num">${__('FG Delivered')}</th>
									<th class="aot-num">${__('Selling Price')}</th>
									<th class="aot-num">${__('Valuation Rate')}</th>
								</tr>
							</thead>
							<tbody class="aot-items-tbody"></tbody>
						</table>
					</div>
				</div>
			</div>

			<div class="aot-panel">
				<div class="aot-panel-head aot-collapsible">
					<div class="aot-panel-head-left">
						<div class="aot-panel-title">${__('Linked documents')}</div>
						<div class="aot-panel-desc">${__('Every document type that can appear in this flow. Dashed cards have not been generated yet.')}</div>
					</div>
					<span class="aot-caret">${frappe.utils.icon('small-down', 'sm')}</span>
				</div>
				<div class="aot-panel-body">
					<div class="aot-doc-catalog-grid aot-doc-grid"></div>
				</div>
			</div>
		</div>

		<div class="aot-modal-backdrop">
			<div class="aot-modal">
				<div class="aot-modal-head">
					<div>
						<div class="aot-modal-eyebrow"></div>
						<div class="aot-modal-title"></div>
					</div>
					<button class="aot-modal-close">&times;</button>
				</div>
				<div class="aot-modal-stats"></div>
				<div class="aot-modal-items-label">${__('Items in this document')}</div>
				<div class="aot-modal-items"></div>
				<div class="aot-modal-footer">
					<button class="btn btn-default btn-sm aot-modal-cancel">${__('Close')}</button>
					<button class="btn btn-primary btn-sm aot-modal-open">${__('Open full record')}</button>
				</div>
			</div>
		</div>

		<div class="aot-doclist-backdrop">
			<div class="aot-doclist-modal">
				<div class="aot-modal-head">
					<div>
						<div class="aot-modal-eyebrow aot-doclist-eyebrow"></div>
						<div class="aot-modal-title aot-doclist-title"></div>
					</div>
					<button class="aot-modal-close aot-doclist-close">&times;</button>
				</div>
				<div class="aot-doclist-hint">${__('Click any document below to preview it.')}</div>
				<div class="aot-doclist-rows"></div>
				<div class="aot-modal-footer">
					<button class="btn btn-default btn-sm aot-doclist-close">${__('Close')}</button>
				</div>
			</div>
		</div>
		`;
	}

	// ---------------------------------------------------------------- events
	bind_events() {
		this.$wrap.on('click', '.aot-reset', () => {
			this.apply_period('monthly', { silent: true });
			const default_company = frappe.defaults.get_default('company') || frappe.sys_defaults?.company || '';
			if (this.company_control) this.company_control.set_value(default_company);
			if (this.project_control) this.project_control.set_value('');
			if (this.so_control) this.so_control.set_value('');
			this.state.selected.clear();
			this.load_list();
		});

		// NEW: period dropdown (Date Range: This Financial Year / Previous
		// Financial Year / Quarterly / Monthly / Weekly / Custom Range).
		this.$wrap.on('click', '.aot-period-btn', (e) => {
			e.stopPropagation();
			this.$wrap.find('.aot-period-menu').toggleClass('open');
		});
		this.$wrap.on('click', '.aot-period-item', (e) => {
			this.apply_period($(e.currentTarget).data('period'));
		});
		// Click anywhere else closes the menu.
		$(document).on('click.aotPeriod', () => {
			if (this.$wrap) this.$wrap.find('.aot-period-menu').removeClass('open');
		});
		this.$wrap.on('click', '.aot-back-link', () => this.go_tab(1));
		this.$wrap.on('click', '.aot-toggle-btn', (e) => {
			const n = Number($(e.currentTarget).data('goto'));
			if (n === 2 && !this.state.currentAo) {
				frappe.show_alert({ message: __('Open an AO from the list first.'), indicator: 'orange' });
				return;
			}
			if (n === 2) {
				this.open_detail(this.state.currentAo);
			} else {
				this.go_tab(1);
			}
		});

		// theme toggle button (sits in the filter bar, after Reset/
		// Apply filters).
		this.$wrap.on('click', '.aot-theme-toggle', () => this.toggle_theme());

		// Refresh icon button in the header, replacing Frappe's own
		// hidden primary-action button. Refreshes whichever tab is open.
		this.$wrap.on('click', '.aot-refresh-btn', () => {
			if (this.state.activeTab === 2 && this.state.currentAo) {
				this.open_detail(this.state.currentAo);
			} else {
				this.load_list();
			}
		});

		// Row-level navigation into the detail view
		this.$wrap.on('click', '.aot-ao-link, .aot-view-btn', (e) => {
			const project = $(e.currentTarget).data('project');
			this.open_detail(project);
		});

		// FIX: the MR/PO/DN/SI status pills in the list table previously had
		// no handler at all, despite being styled as clickable links.
		this.$wrap.on('click', '.aot-doc-link', (e) => {
			e.stopPropagation();
			const doctype = $(e.currentTarget).data('doctype');
			const name = $(e.currentTarget).data('name');
			if (doctype && name) frappe.set_route('Form', doctype, name);
		});

		// NEW: "N Sales Invoices" style chip, shown when a project has more
		// than one document of that type. Opens a list so the user can go
		// through each document one by one instead of only seeing the latest.
		this.$wrap.on('click', '.aot-doc-multi', (e) => {
			e.stopPropagation();
			const project = $(e.currentTarget).data('project');
			const key = $(e.currentTarget).data('key');
			const label = $(e.currentTarget).data('label');
			const color = $(e.currentTarget).data('color');
			this.open_doc_list_modal(project, key, label, color);
		});

		// Doc catalog cards (Tab 2) open a preview modal instead of jumping
		// straight into the form.
		this.$wrap.on('click', '.aot-doc-card:not(.empty):not(.unavailable)', (e) => {
			const doctype = $(e.currentTarget).data('doctype');
			const name = $(e.currentTarget).data('name');
			this.open_doc_modal(doctype, name);
		});

		this.$wrap.on('click', '.aot-modal-close, .aot-modal-cancel, .aot-modal-backdrop', function (e) {
			if (e.target === this) $(this).closest('.ao-tracker-wrap').find('.aot-modal-backdrop').removeClass('open');
		});
		this.$wrap.on('click', '.aot-modal', (e) => e.stopPropagation());
		this.$wrap.on('click', '.aot-modal-open', () => {
			const doctype = this.$wrap.find('.aot-modal').data('doctype');
			const name = this.$wrap.find('.aot-modal').data('name');
			if (doctype && name) frappe.set_route('Form', doctype, name);
		});
		this.$wrap.on('click', '.aot-modal-item-ref', (e) => {
			e.stopPropagation();
			const doctype = $(e.currentTarget).data('doctype');
			const name = $(e.currentTarget).data('name');
			if (doctype && name) frappe.set_route('Form', doctype, name);
		});

		// NEW: doc-list modal (the "N Sales Invoices" browser)
		this.$wrap.on('click', '.aot-doclist-close, .aot-doclist-backdrop', function (e) {
			if (e.target === this) $(this).closest('.ao-tracker-wrap').find('.aot-doclist-backdrop').removeClass('open');
		});
		this.$wrap.on('click', '.aot-doclist-modal', (e) => e.stopPropagation());
		this.$wrap.on('click', '.aot-doclist-row', (e) => {
			const doctype = $(e.currentTarget).data('doctype');
			const name = $(e.currentTarget).data('name');
			if (!doctype || !name) return;
			// Go through them "one by one": close the list, open the
			// familiar single-document preview modal for the picked row.
			this.$wrap.find('.aot-doclist-backdrop').removeClass('open');
			this.open_doc_modal(doctype, name);
		});

		// Collapsible panels
		this.$wrap.on('click', '.aot-collapsible', (e) => {
			$(e.currentTarget).closest('.aot-panel').toggleClass('collapsed');
		});

		// Row selection
		this.$wrap.on('click', '.aot-row-check', (e) => e.stopPropagation());
		this.$wrap.on('change', '.aot-row-check', (e) => {
			const project = $(e.currentTarget).data('project');
			if (e.currentTarget.checked) this.state.selected.add(project);
			else this.state.selected.delete(project);
		});
		this.$wrap.on('change', '.aot-select-all', (e) => {
			const checked = e.currentTarget.checked;
			this.$wrap.find('.aot-row-check').prop('checked', checked).each((_, el) => {
				const project = $(el).data('project');
				if (checked) this.state.selected.add(project);
				else this.state.selected.delete(project);
			});
		});
	}

	go_tab(n) {
		this.state.activeTab = n;
		this.$wrap.find('.aot-view').removeClass('active');
		this.$wrap.find(`.aot-view[data-view="${n}"]`).addClass('active');
		this.$wrap.find('.aot-toggle-btn').removeClass('active');
		this.$wrap.find(`.aot-toggle-btn[data-goto="${n}"]`).addClass('active');
	}

	// ---------------------------------------------------------------- tab 1
	load_list() {
		const args = {
			from_date: this.$wrap.find('.aot-f-from').val(),
			to_date: this.$wrap.find('.aot-f-to').val(),
			company: this.company_control ? this.company_control.get_value() : '',
			project: this.project_control ? this.project_control.get_value() : '',
			sales_order: this.so_control ? this.so_control.get_value() : ''
		};
		frappe.call({
			method: this.method.list,
			args,
			freeze: true,
			callback: (r) => {
				this.state.list = r.message || [];
				this.render_list();
			}
		});
	}

	render_list() {
		const list = this.state.list;
		this.$wrap.find('.aot-result-count').text(
			list.length === 1 ? __('1 result') : __('{0} results', [list.length])
		);

		const $tbody = this.$wrap.find('.aot-tbody').empty();
		this.$wrap.find('.aot-select-all').prop('checked', false);
		// 5 fixed columns (checkbox, AO Number, Sales Order, Customer,
		// Pending At) + one label/status pair per doc column + Priority +
		// the row-action column.
		const colspan = 7 + (this.doc_columns.length * 2);
		if (!list.length) {
			$tbody.html(`<tr><td colspan="${colspan}" class="aot-empty-row">${__('No advance orders match these filters.')}</td></tr>`);
			return;
		}

		list.forEach((ao) => {
			$tbody.append(this.render_list_row(ao));
		});
	}

	render_list_row(ao) {
		const docPair = (col) => {
			const d = ao.docs[col.key];
			if (!d) {
				// FIX: blank cells instead of a "—" placeholder.
				return `<td class="aot-grp-start"></td><td></td>`;
			}

			// NEW: when more than one document of this type exists for the
			// project, don't just quietly show the latest one — show a
			// "N {label}s" chip. Clicking it lists every one of them so the
			// user can go through them one by one (see open_doc_list_modal).
			if (d.count && d.count > 1) {
				const plural = col.full_label || (col.label + 's');
				return `
					<td class="aot-grp-start" colspan="2">
						<span class="aot-doc-multi"
							style="color:${col.color};border-color:${col.color};"
							data-project="${frappe.utils.escape_html(ao.project)}"
							data-key="${frappe.utils.escape_html(col.key)}"
							data-label="${frappe.utils.escape_html(plural)}"
							data-color="${frappe.utils.escape_html(col.color)}">
							${d.count} ${frappe.utils.escape_html(plural)}
						</span>
					</td>
				`;
			}

			const [bg, ink] = this.tone(d.status);
			// FIX: doctype is now attached so the click handler can route
			// correctly instead of silently doing nothing.
			return `
				<td class="aot-grp-start">
					<span class="aot-doc-link" style="color:${col.color};" data-doctype="${frappe.utils.escape_html(d.doctype || '')}" data-name="${frappe.utils.escape_html(d.name)}">${frappe.utils.escape_html(d.name)}</span>
				</td>
				<td><span class="aot-mini-pill" style="background:${bg};color:${ink};">${frappe.utils.escape_html(d.status || '')}</span></td>
			`;
		};

		// Priority is computed server-side (see ao_tracker.py::determine_priority)
		// from the days remaining between the linked Sales Order's Delivery
		// Date and today. Blank when there's nothing to compute it from yet.
		const priorityClass = this.priority_class(ao.priority);
		const checked = this.state.selected.has(ao.project) ? 'checked' : '';

		// FIX: previously showed the AO number twice (the link, then an
		// identical subtitle) whenever project_name happened to equal the
		// project code. Only show the subtitle when it actually adds info.
		const showSubtitle = ao.project_name && ao.project_name.trim().toLowerCase() !== ao.project.trim().toLowerCase();

		return `
		<tr>
			<td><input type="checkbox" class="aot-row-check" data-project="${frappe.utils.escape_html(ao.project)}" ${checked}></td>
			<td><a class="aot-ao-link" data-project="${frappe.utils.escape_html(ao.project)}">${frappe.utils.escape_html(ao.project)}</a>
				${showSubtitle ? `<div class="aot-project-name">${frappe.utils.escape_html(ao.project_name)}</div>` : ''}
			</td>
			<td class="aot-so-col">${ao.so ? `<span class="aot-doc-link aot-so-link" data-doctype="Sales Order" data-name="${frappe.utils.escape_html(ao.so)}">${frappe.utils.escape_html(ao.so)}</span>` : ''}</td>
			<td class="aot-customer-cell" title="${frappe.utils.escape_html(ao.customer || '')}">${ao.customer ? `<span class="aot-doc-link aot-customer-link" data-doctype="Customer" data-name="${frappe.utils.escape_html(ao.customer)}">${frappe.utils.escape_html(ao.customer)}</span>` : ''}</td>
			<td class="aot-pending-cell">${ao.pending_at ? `<span class="aot-pending-chip ${ao.pending_at === 'Completed' ? 'aot-chip-completed' : ''}" title="${frappe.utils.escape_html(ao.pending_at)}">${frappe.utils.escape_html(this.format_pending_at(ao.pending_at))}</span>` : ''}</td>
			${this.doc_columns.map(col => docPair(col)).join('')}
			<td class="aot-grp-start aot-priority-col">${ao.priority ? `<span class="aot-pri-badge ${priorityClass}">${frappe.utils.escape_html(ao.priority)}</span>` : ''}</td>
			<td><button class="aot-view-btn" data-project="${frappe.utils.escape_html(ao.project)}" title="${__('Detailed view')}">${frappe.utils.icon('right', 'sm')}</button></td>
		</tr>
		`;
	}

	// NEW: maps a priority label (from the backend) to its badge color
	// class. Low -> green, Medium -> amber, High -> orange, Urgent -> red,
	// Overdue -> solid dark red.
	priority_class(priority) {
		if (!priority) return '';
		if (priority.startsWith('Overdue')) return 'aot-pri-overdue';
		const MAP = {
			Low: 'aot-pri-low',
			Medium: 'aot-pri-medium',
			High: 'aot-pri-high',
			Urgent: 'aot-pri-urgent'
		};
		return MAP[priority] || 'aot-pri-low';
	}

	// some `pending_at` values combine two alternative next steps
	// with a "/" (e.g. "Purchase Order / Subcontracting Order creation"),
	// which wrapped onto 2-3 lines inside the pill. Only the current
	// pending step is shown in the pill itself; the full original text
	// is still available as a hover tooltip (see render_list_row).
	format_pending_at(text) {
		if (!text) return text;
		return text.split(/\s*\/\s*/)[0];
	}

	tone(status) {
		const TONE = {
			'Partially Ordered': 'amber', Submitted: 'amber', Expired: 'red', 'To Receive and Bill': 'amber',
			Received: 'green', Unpaid: 'amber', Draft: 'gray', Approved: 'green', Completed: 'green',
			'Pending Approval': 'amber', Passed: 'green', Failed: 'red', Open: 'amber', Closed: 'green',
			Booked: 'green', Confirmed: 'green', Converted: 'green', Posted: 'green', Paid: 'green'
		};
		const MAP = {
			amber: ['var(--aot-amber-bg)', 'var(--aot-amber-ink)'],
			red: ['var(--aot-red-bg)', 'var(--aot-red-ink)'],
			green: ['var(--aot-green-bg)', 'var(--aot-green-ink)'],
			gray: ['var(--aot-gray-bg)', 'var(--aot-gray-ink)']
		};
		return MAP[TONE[status] || 'gray'];
	}

	// ---------------------------------------------------------------- tab 2
	open_detail(project) {
		this.state.currentAo = project;
		frappe.call({
			method: this.method.detail,
			args: { project },
			freeze: true,
			callback: (r) => {
				if (!r.message) return;
				this.render_detail(r.message);
				this.go_tab(2);
			}
		});
	}

	render_detail(ao) {
		this.$wrap.find('.aot-d-title').text(ao.project);
		const dateFmt = ao.date ? frappe.datetime.str_to_user(ao.date) : '';
		this.$wrap.find('.aot-d-sub').text(
			`${ao.project_name || ''} \u00b7 ${ao.customer || ''}${dateFmt ? ' \u00b7 ' + __('opened') + ' ' + dateFmt : ''}`
		);
		const [bg, ink] = this.tone(ao.status);
		this.$wrap.find('.aot-d-status-pill').css({ background: bg, color: ink }).text(ao.status || '');

		this.render_overview(ao.overview);
		this.render_items_table(ao.items.rows || []);
		this.render_doc_catalog(ao);
	}

	render_overview(o) {
		const cur = o.currency || 'INR';
		const inr = (n) => format_currency(n || 0, cur);
		const revSub = (o.foreign_currency && o.foreign_currency !== cur && o.foreign_revenue)
			? `${format_currency(o.foreign_revenue, o.foreign_currency)} \u00b7 ${__('Converted to')} ${cur}`
			: __('From Sales Invoice, or Sales Order if none yet');

		const cards = [
			[__('Est. Revenue'), inr(o.revenue), revSub, undefined, '#0284C7'],
			[__('Total RM Cost'), inr(o.rm_cost), __('Valuation rate \u00d7 qty consumed'), undefined, '#D97706'],
			[__('Total Indirect Expense'), inr(o.indirect), __('Overheads allocated to this AO'), undefined, '#E11D48'],
			[__('Profitability %'), (o.profit_pct || 0).toFixed(1) + '%', __('Profit \u00f7 estimated revenue'), o.profit_pct >= 0, '#7C3AED'],
			[__('Profit'), inr(o.profit), __('Revenue \u2212 RM cost \u2212 indirect expense'), o.profit >= 0, '#059669']
		];
		this.$wrap.find('.aot-overview-grid').html(cards.map(([label, value, sub, positive, color]) => `
			<div class="aot-stat-card" style="border-top:3px solid ${color};">
				<div class="aot-stat-label" style="color:${color};">${label}</div>
				<div class="aot-stat-value ${positive === true ? 'aot-positive' : positive === false ? 'aot-negative' : ''}">${value}</div>
				<div class="aot-stat-sub">${sub}</div>
			</div>
		`).join(''));
	}

	// Combined FG -> RM breakdown, replacing the old two disconnected tables.
	render_items_table(rows) {
		const $tbody = this.$wrap.find('.aot-items-tbody').empty();
		if (!rows.length) {
			$tbody.html(`<tr><td colspan="9" class="aot-empty-row">${__('No Sales Order items linked to this Project.')}</td></tr>`);
			return;
		}

		const num = (v) => (v === null || v === undefined) ? '' : format_number(v);

		rows.forEach((row) => {
			const typeClass = row.type === 'FG' ? 'aot-type-fg' : 'aot-type-rm';

			// Selling price in order currency (e.g. USD, EUR, INR)
			let sellingPriceHtml = '—';
			if (row.selling_price !== null && row.selling_price !== undefined) {
				const orderCurr = row.currency || row.company_currency || 'INR';
				sellingPriceHtml = format_currency(row.selling_price, orderCurr);
			}

			// Valuation rate in company base currency (e.g. INR)
			let valRateHtml = '<span style="color:var(--aot-ink-faint);">—</span>';
			if (row.valuation_rate !== null && row.valuation_rate !== undefined && row.valuation_rate > 0) {
				const baseCurr = row.company_currency || 'INR';
				valRateHtml = format_currency(row.valuation_rate, baseCurr);
			} else if (row.is_stock_item === 0) {
				valRateHtml = '<span style="color:var(--aot-ink-faint);" title="Non-stock item">—</span>';
			}

			$tbody.append(`
				<tr class="${row.group_start ? 'aot-group-start' : ''}">
					<td>
						${row.order_item ? `<div class="aot-fg-name">${frappe.utils.escape_html(row.order_item)}</div><div class="aot-fg-code">${frappe.utils.escape_html(row.item_code || '')}</div>` : ''}
					</td>
					<td><span class="aot-type-badge ${typeClass}">${row.type}</span></td>
					<td>
						${row.component_name ? `<div class="aot-fg-name">${frappe.utils.escape_html(row.component_name)}</div><div class="aot-fg-code">${frappe.utils.escape_html(row.component_code || '')}</div>` : ''}
					</td>
					<td class="aot-num">${num(row.qty_needed)}</td>
					<td class="aot-num">${num(row.total_ordered)}</td>
					<td class="aot-num">${num(row.consumed)}</td>
					<td class="aot-num">${num(row.fg_delivered)}</td>
					<td class="aot-num">${sellingPriceHtml}</td>
					<td class="aot-num">${valRateHtml}</td>
				</tr>
			`);
		});
	}

	render_doc_catalog(ao) {
		const grid = this.$wrap.find('.aot-doc-grid').empty();
		(ao.doc_order || []).forEach((key) => {
			const meta = ao.doc_meta[key];
			const d = ao.docs[key];
			const accent = this.doc_type_colors[key] || 'var(--aot-accent)';

			if (!meta.queryable) {
				grid.append(`
					<div class="aot-doc-card empty unavailable" style="border-top:3px solid ${accent};opacity:.6;">
						<div class="aot-doc-count-badge aot-count-zero">0</div>
						<div class="aot-doc-type-label">${meta.short} \u00b7 ${meta.label}</div>
						<div class="aot-doc-code empty">${__('Not applicable')}</div>
					</div>
				`);
				return;
			}

			if (!d) {
				grid.append(`
					<div class="aot-doc-card empty" style="border-top:3px solid ${accent};">
						<div class="aot-doc-count-badge aot-count-zero">0</div>
						<div class="aot-doc-type-label">${meta.short} \u00b7 ${meta.label}</div>
						<div class="aot-doc-code empty">${__('Not generated')}</div>
					</div>
				`);
				return;
			}

			const [bg, ink] = this.tone(d.status);

			// NEW: if there's more than one of this doc type, the card opens
			// the same "go through them one by one" list as the Tab 1 chip,
			// instead of jumping straight to the (arbitrarily-picked) latest one.
			if (d.count && d.count > 1) {
				grid.append(`
					<div class="aot-doc-card aot-doc-card-multi" style="border-top:3px solid ${accent};"
						data-project="${frappe.utils.escape_html(ao.project)}" data-key="${frappe.utils.escape_html(key)}"
						data-label="${frappe.utils.escape_html(meta.label + 's')}" data-color="${frappe.utils.escape_html(accent)}">
						<div class="aot-doc-count-badge aot-count-pos">${d.count}</div>
						<div class="aot-doc-type-label" style="color:${accent};">${meta.short} \u00b7 ${meta.label}</div>
						<div class="aot-doc-code">${d.count} ${frappe.utils.escape_html(meta.label)}s</div>
						<div class="aot-mini-pill" style="background:${bg};color:${ink};">${__('Latest')}: ${frappe.utils.escape_html(d.status || '')}</div>
						<div class="aot-open-link">${__('Click to view all')}</div>
					</div>
				`);
				return;
			}

			grid.append(`
				<div class="aot-doc-card" style="border-top:3px solid ${accent};" data-doctype="${frappe.utils.escape_html(d.doctype || meta.doctype || '')}" data-name="${frappe.utils.escape_html(d.name)}">
					<div class="aot-doc-count-badge aot-count-pos">${d.count || 1}</div>
					<div class="aot-doc-type-label" style="color:${accent};">${meta.short} \u00b7 ${meta.label}</div>
					<div class="aot-doc-code">${frappe.utils.escape_html(d.name)}</div>
					<div class="aot-mini-pill" style="background:${bg};color:${ink};">${frappe.utils.escape_html(d.status || '')}</div>
					<div class="aot-open-link">${__('Click to preview')}</div>
				</div>
			`);
		});

		// route Tab 2's multi-doc cards through the same list modal as the
		// Tab 1 chip.
		grid.find('.aot-doc-card-multi').off('click.aotmulti').on('click.aotmulti', (e) => {
			const $t = $(e.currentTarget);
			this.open_doc_list_modal($t.data('project'), $t.data('key'), $t.data('label'), $t.data('color'));
		});
	}

	// ------------------------------------------------------------ doc modal
	open_doc_modal(doctype, name) {
		if (!doctype || !name) return;
		frappe.call({
			method: this.method.doc_summary,
			args: { doctype, name },
			freeze: true,
			callback: (r) => {
				if (!r.message) return;
				this.render_doc_modal(r.message);
			}
		});
	}

	render_doc_modal(d) {
		const $modal = this.$wrap.find('.aot-modal');
		$modal.data('doctype', d.doctype).data('name', d.name);

		this.$wrap.find('.aot-modal-eyebrow').text(`${d.doctype.toUpperCase()} \u00b7 ${d.project || ''}`);
		this.$wrap.find('.aot-modal-title').text(d.name);

		const [bg, ink] = this.tone(d.status);

		// Payment Entry special view (financial transaction, no item rows)
		if (d.is_payment) {
			const stats = [
				[__('Status'), `<span class="aot-mini-pill" style="background:${bg};color:${ink};">${frappe.utils.escape_html(d.status || '')}</span>`, true],
				[__('Party'), frappe.utils.escape_html(d.party || '')],
				[__('Amount'), format_currency(d.paid_amount || 0)],
				[__('Payment Type'), frappe.utils.escape_html(d.payment_type || d.mode_of_payment || '')]
			];
			this.$wrap.find('.aot-modal-stats').html(stats.map(([label, value, isHtml]) => `
				<div class="aot-modal-stat">
					<div class="aot-modal-stat-label">${label}</div>
					<div class="aot-modal-stat-value">${isHtml ? value : frappe.utils.escape_html(String(value))}</div>
				</div>
			`).join(''));

			this.$wrap.find('.aot-modal-items-label').text(__('Allocated References'));
			const $items = this.$wrap.find('.aot-modal-items').empty();
			if (!d.references || !d.references.length) {
				$items.html(`<div class="aot-empty-row">${__('No allocated references on this payment.')}</div>`);
			} else {
				d.references.forEach((ref) => {
					$items.append(`
						<div class="aot-modal-item-row">
							<div>
								<div class="aot-fg-name">${frappe.utils.escape_html(ref.reference_doctype)}: <span class="aot-doc-link" data-doctype="${frappe.utils.escape_html(ref.reference_doctype)}" data-name="${frappe.utils.escape_html(ref.reference_name)}">${frappe.utils.escape_html(ref.reference_name)}</span></div>
								<div class="aot-fg-code">${__('Total')}: ${format_currency(ref.total_amount || 0)}</div>
							</div>
							<div class="aot-modal-item-qty">${__('Allocated')}: ${format_currency(ref.allocated_amount || 0)}</div>
						</div>
					`);
				});
			}
			this.$wrap.find('.aot-modal-backdrop').addClass('open');
			return;
		}

		// Journal Entry special view (accounting transaction, no item rows)
		if (d.is_journal) {
			const stats = [
				[__('Status'), `<span class="aot-mini-pill" style="background:${bg};color:${ink};">${frappe.utils.escape_html(d.status || '')}</span>`, true],
				[__('Total Debit'), format_currency(d.total_debit || 0)],
				[__('Posting Date'), frappe.utils.escape_html(d.posting_date || '')],
				[__('Reference AO'), frappe.utils.escape_html(d.project || '')]
			];
			this.$wrap.find('.aot-modal-stats').html(stats.map(([label, value, isHtml]) => `
				<div class="aot-modal-stat">
					<div class="aot-modal-stat-label">${label}</div>
					<div class="aot-modal-stat-value">${isHtml ? value : frappe.utils.escape_html(String(value))}</div>
				</div>
			`).join(''));

			this.$wrap.find('.aot-modal-items-label').text(__('Accounting Entries'));
			const $items = this.$wrap.find('.aot-modal-items').empty();
			if (!d.accounts || !d.accounts.length) {
				$items.html(`<div class="aot-empty-row">${__('No accounting entries on this journal.')}</div>`);
			} else {
				d.accounts.forEach((acc) => {
					const amt = acc.debit > 0 ? `${__('Dr')}: ${format_currency(acc.debit)}` : `${__('Cr')}: ${format_currency(acc.credit)}`;
					$items.append(`
						<div class="aot-modal-item-row">
							<div>
								<div class="aot-fg-name">${frappe.utils.escape_html(acc.account)}</div>
								${acc.party ? `<div class="aot-fg-code">${frappe.utils.escape_html(acc.party)}</div>` : ''}
							</div>
							<div class="aot-modal-item-qty">${amt}</div>
						</div>
					`);
				});
			}
			this.$wrap.find('.aot-modal-backdrop').addClass('open');
			return;
		}

		// Standard document view
		this.$wrap.find('.aot-modal-items-label').text(__('Items in this document'));
		const stats = [
			[__('Status'), `<span class="aot-mini-pill" style="background:${bg};color:${ink};">${frappe.utils.escape_html(d.status || '')}</span>`, true],
			[__('Reference AO'), frappe.utils.escape_html(d.project || '')],
			[__('Items'), (d.items || []).length],
			[__('Total Qty'), format_number(d.total_qty || 0)]
		];
		this.$wrap.find('.aot-modal-stats').html(stats.map(([label, value, isHtml]) => `
			<div class="aot-modal-stat">
				<div class="aot-modal-stat-label">${label}</div>
				<div class="aot-modal-stat-value">${isHtml ? value : frappe.utils.escape_html(String(value))}</div>
			</div>
		`).join(''));

		const $items = this.$wrap.find('.aot-modal-items').empty();
		if (!d.items || !d.items.length) {
			$items.html(`<div class="aot-empty-row">${__('No item rows on this document.')}</div>`);
		} else {
			d.items.forEach((it) => {
				$items.append(`
					<div class="aot-modal-item-row">
						<div>
							<div class="aot-fg-name">${frappe.utils.escape_html(it.item_name)}</div>
							<div class="aot-fg-code">${frappe.utils.escape_html(it.item_code || '')}</div>
						</div>
						<div class="aot-modal-item-qty">${format_number(it.qty)} ${frappe.utils.escape_html(it.uom || '')}</div>
					</div>
				`);
			});
		}

		this.$wrap.find('.aot-modal-backdrop').addClass('open');
	}

	// ------------------------------------------------------- doc list modal
	// NEW: powers the "N Sales Invoices" / "N Work Orders" chip. Fetches
	// every document of `key`'s type for `project` and lets the user click
	// through them one at a time (each row opens the existing single-doc
	// preview modal above).
	open_doc_list_modal(project, key, label, color) {
		if (!project || !key) return;
		frappe.call({
			method: this.method.doc_list,
			args: { project, key },
			freeze: true,
			callback: (r) => {
				this.render_doc_list_modal(label, color, r.message || []);
			}
		});
	}

	render_doc_list_modal(label, color, rows) {
		this.$wrap.find('.aot-doclist-eyebrow').text(label || __('Documents'));
		this.$wrap.find('.aot-doclist-title').text(
			rows.length === 1 ? __('1 document') : __('{0} documents', [rows.length])
		);

		const $rows = this.$wrap.find('.aot-doclist-rows').empty();
		if (!rows.length) {
			$rows.html(`<div class="aot-empty-row">${__('No documents found.')}</div>`);
		} else {
			rows.forEach((d) => {
				const [bg, ink] = this.tone(d.status);
				$rows.append(`
					<div class="aot-doclist-row" data-doctype="${frappe.utils.escape_html(d.doctype)}" data-name="${frappe.utils.escape_html(d.name)}">
						<span class="aot-doclist-dot" style="background:${color || 'var(--aot-accent)'};"></span>
						<span class="aot-doclist-name">${frappe.utils.escape_html(d.name)}</span>
						<span class="aot-mini-pill" style="background:${bg};color:${ink};">${frappe.utils.escape_html(d.status || '')}</span>
						<span class="aot-doclist-arrow">${frappe.utils.icon('right', 'xs')}</span>
					</div>
				`);
			});
		}

		this.$wrap.find('.aot-doclist-backdrop').addClass('open');
	}

	// ---------------------------------------------------------------- css
	css() {
		return `
		.ao-tracker-wrap{
			--aot-bg:#F5F6FB; --aot-panel:#FFFFFF; --aot-ink:#1B2130; --aot-ink-soft:#5B6478; --aot-ink-faint:#8B93A6;
			--aot-line:#E4E7EE; --aot-line-soft:#EEF0F5; --aot-accent:#4F46E5; --aot-accent-soft:#EEECFC;
			--aot-amber-bg:#FDF1DC; --aot-amber-ink:#9A5B00; --aot-red-bg:#FBE4E1; --aot-red-ink:#C0392B;
			--aot-green-bg:#E1F5EA; --aot-green-ink:#1E8E56; --aot-gray-bg:#EEF0F5; --aot-gray-ink:#5B6478;
			--aot-purple-bg:#EFE9FC; --aot-purple-ink:#6B3FBF;
			--aot-orange-bg:#FDE4CE; --aot-orange-ink:#B85C00;
			--aot-overdue-bg:#7F1D1D; --aot-overdue-ink:#FFFFFF;
			--aot-radius:12px; --aot-shadow:0 1px 2px rgba(20,24,40,.04),0 8px 24px -12px rgba(20,24,40,.10);
			color:var(--aot-ink); padding:18px 20px 48px; background:var(--aot-bg);
			transition:background .2s ease, color .2s ease;
		}

		/* ============================================================
		   DARK THEME
		   Same variable names as the light block above, just re-defined
		   with dark values (palette matches the Executive Dashboard's own
		   dark mode: bg #14161f, surface #1c1f2b, border #2c2f3d, etc.)
		   Everything else in this file already renders via these
		   variables, so no other rule needs to change.
		   ============================================================ */
		.ao-tracker-wrap[data-theme="dark"]{
			--aot-bg:#14161f; --aot-panel:#1c1f2b; --aot-ink:#f3f4f6; --aot-ink-soft:#cbd0dc; --aot-ink-faint:#8b8fa3;
			--aot-line:#2c2f3d; --aot-line-soft:#242733; --aot-accent:#818CF8; --aot-accent-soft:#262a45;
			--aot-amber-bg:#3a2c10; --aot-amber-ink:#fbbf24; --aot-red-bg:#3a1414; --aot-red-ink:#f87171;
			--aot-green-bg:#12291d; --aot-green-ink:#34d399; --aot-gray-bg:#262a38; --aot-gray-ink:#9ca3af;
			--aot-purple-bg:#2a2140; --aot-purple-ink:#a78bfa;
			--aot-orange-bg:#3a2413; --aot-orange-ink:#fb923c;
			--aot-overdue-bg:#7f1d1d; --aot-overdue-ink:#fecaca;
			--aot-shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.65);
		}
		/* native date/text inputs: let the browser paint its own dark
		   chrome (calendar icon etc.) instead of a light box on dark bg */
		.ao-tracker-wrap[data-theme="dark"] input[type="date"],
		.ao-tracker-wrap[data-theme="dark"] input[type="text"]{ color-scheme:dark; }
		/* the handful of hardcoded (non-variable) colors in this file */
		.ao-tracker-wrap[data-theme="dark"] .aot-status-table thead th{
			background:linear-gradient(180deg,#20232f 0%,#1c1f2b 100%);
		}
		.ao-tracker-wrap[data-theme="dark"] .aot-status-table tbody tr:nth-child(even){ background:#191c26; }
		.ao-tracker-wrap[data-theme="dark"] .aot-doc-card.empty,
		.ao-tracker-wrap[data-theme="dark"] .aot-stat-card{ background:#171922; }
		.ao-tracker-wrap[data-theme="dark"] .aot-modal-backdrop,
		.ao-tracker-wrap[data-theme="dark"] .aot-doclist-backdrop{ background:rgba(0,0,0,.6); }
		.ao-tracker-wrap[data-theme="dark"] .aot-doclist-row{ background:#171922; }
		/* Frappe's own .btn-default / .btn-primary come from desk-wide
		   CSS, not this file's variables - re-skin them inside our wrap
		   only, so filter/modal buttons match dark mode too. */
		.ao-tracker-wrap[data-theme="dark"] .btn-default{
			background:#232634; color:var(--aot-ink); border-color:var(--aot-line);
		}
		.ao-tracker-wrap[data-theme="dark"] .btn-default:hover{ background:#2b2f40; }

		/* Flat, light header card - no gradient. Uses the same panel/
		   border/shadow tokens as every other card on this page, so it
		   sits visually level with the filter bar right below it and
		   adapts to dark mode automatically. */
		.ao-tracker-wrap .aot-topbar{display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; flex-wrap:wrap; gap:12px; background:var(--aot-panel); border:1px solid var(--aot-line); border-radius:var(--aot-radius); padding:16px 20px; box-shadow:var(--aot-shadow);}
		.ao-tracker-wrap .aot-topbar-title{display:flex; align-items:center; gap:10px;}
		.ao-tracker-wrap .aot-topbar-badge{width:36px; height:36px; border-radius:10px; background:var(--aot-accent); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px;}
		.ao-tracker-wrap .aot-topbar-heading{font-size:16px; font-weight:800; color:var(--aot-ink);}
		.ao-tracker-wrap .aot-topbar-sub{font-size:12px; color:var(--aot-ink-faint);}
		/* Wraps the segmented toggle + Refresh button so they sit
		   together on the right side of the topbar. */
		.ao-tracker-wrap .aot-topbar-actions{display:flex; align-items:center; gap:10px;}
		.ao-tracker-wrap .aot-toggle{display:inline-flex; background:var(--aot-bg); border:1px solid var(--aot-line); border-radius:9px; padding:3px; gap:2px;}
		.ao-tracker-wrap .aot-toggle-btn{border:none; background:transparent; padding:7px 14px; border-radius:7px; font-size:13px; font-weight:700; color:var(--aot-ink-soft); cursor:pointer; transition:color .15s ease;}
		.ao-tracker-wrap .aot-toggle-btn:hover:not(.active){color:var(--aot-ink);}
		.ao-tracker-wrap .aot-toggle-btn.active{background:var(--aot-panel); color:var(--aot-ink); box-shadow:var(--aot-shadow);}
		/* Shared neutral icon-button style, used by both the header's
		   Refresh button and the filter bar's theme toggle - a plain
		   bordered square that reads correctly on any light/dark card,
		   instead of the old translucent-white-on-gradient look. */
		.ao-tracker-wrap .aot-icon-btn{
			width:34px; height:34px; flex-shrink:0; border-radius:8px;
			border:1px solid var(--aot-line); background:var(--aot-panel);
			color:var(--aot-ink-soft); display:flex; align-items:center; justify-content:center;
			cursor:pointer; transition:background .15s ease, border-color .15s ease, color .15s ease, transform .15s ease;
		}
		.ao-tracker-wrap .aot-icon-btn:hover{ background:var(--aot-accent-soft); border-color:var(--aot-accent); color:var(--aot-accent); transform:translateY(-1px); }
		.ao-tracker-wrap .aot-view{display:none;}
		.ao-tracker-wrap .aot-view.active{display:block;}
		.ao-tracker-wrap .aot-filters{
			background:var(--aot-panel); border:1px solid var(--aot-line); border-radius:var(--aot-radius);
			padding:10px 14px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;
			box-shadow:var(--aot-shadow); margin-bottom:18px;
		}
		/* Shared "pill" look for Company / Date Range / Project / Sales
		   Order - icon + control, single flat box, all sitting on one
		   baseline like the reference dashboard's topbar. */
		.ao-tracker-wrap .aot-pill-field{
			display:flex; align-items:center; gap:7px; height:36px; padding:0 12px;
			border:1px solid var(--aot-line); border-radius:9px; background:var(--aot-bg);
			position:relative;
		}
		.ao-tracker-wrap .aot-pill-icon{ display:flex; color:var(--aot-ink-faint); flex-shrink:0; }
		.ao-tracker-wrap .aot-pill-input{ display:flex; align-items:center; }
		.ao-tracker-wrap .aot-pill-input .frappe-control{ margin:0; }
		.ao-tracker-wrap .aot-pill-input input{
			border:none; background:transparent; padding:0; font-size:13px; font-weight:700;
			color:var(--aot-ink); min-width:130px; box-shadow:none !important;
		}
		.ao-tracker-wrap .aot-pill-input input::placeholder{ font-weight:600; color:var(--aot-ink-faint); }
		.ao-tracker-wrap .aot-pill-input input:focus{ outline:none; box-shadow:none; }

		/* Date Range dropdown button reuses the pill shell as its own element */
		.ao-tracker-wrap .aot-period-dropdown{ padding:0; }
		.ao-tracker-wrap .aot-period-btn{
			display:flex; align-items:center; gap:7px; height:36px; padding:0 12px; border:none; background:none;
			font-size:13px; font-weight:700; color:var(--aot-ink); cursor:pointer; white-space:nowrap;
		}
		.ao-tracker-wrap .aot-period-btn svg{ color:var(--aot-ink-faint); flex-shrink:0; }
		.ao-tracker-wrap .aot-period-label{ flex:1; text-align:left; }
		.ao-tracker-wrap .aot-period-menu{
			display:none; position:absolute; top:calc(100% + 6px); left:0; min-width:220px; z-index:50;
			background:var(--aot-panel); border:1px solid var(--aot-line); border-radius:9px;
			box-shadow:0 12px 32px -8px rgba(20,24,40,.25); overflow:hidden; padding:4px;
		}
		.ao-tracker-wrap .aot-period-menu.open{ display:block; }
		.ao-tracker-wrap .aot-period-item{
			padding:8px 12px; font-size:13px; font-weight:600; color:var(--aot-ink); border-radius:6px; cursor:pointer;
		}
		.ao-tracker-wrap .aot-period-item:hover{ background:var(--aot-accent-soft); }
		.ao-tracker-wrap .aot-period-item.active{ background:var(--aot-accent); color:#fff; }

		/* Plain From/To date boxes (locked/read-only for every preset
		   except Custom Range), with a bare "to" label between them —
		   matches the reference screenshot's flat, unbordered look. */
		.ao-tracker-wrap .aot-daterange-box{
			height:36px; display:flex; align-items:center; padding:0 12px; border-radius:9px;
			background:var(--aot-bg); border:1px solid var(--aot-line);
		}
		.ao-tracker-wrap .aot-daterange-box input{
			border:none; background:transparent; padding:0; font-size:13px; font-weight:600;
			color:var(--aot-ink-soft); width:100px; box-shadow:none !important;
		}
		.ao-tracker-wrap .aot-daterange-box input:focus{ outline:none; }
		.ao-tracker-wrap .aot-date-sep{ font-size:13px; color:var(--aot-ink-faint); font-weight:600; }

		.ao-tracker-wrap .aot-filter-actions{display:flex; align-items:center; gap:8px; margin-left:auto;}
		/* "Apply filters" (and the modal's "Open full record") use the
		   dashboard's own accent blue rather than Frappe's default
		   dark/black .btn-primary, so it matches the rest of the page. */
		.ao-tracker-wrap .aot-filters .btn-primary,
		.ao-tracker-wrap .aot-modal-footer .btn-primary{
			background:var(--aot-accent); border-color:var(--aot-accent); color:#fff;
		}
		.ao-tracker-wrap .aot-filters .btn-primary:hover,
		.ao-tracker-wrap .aot-modal-footer .btn-primary:hover{
			filter:brightness(0.92);
		}
		.ao-tracker-wrap .aot-section-head{display:flex; align-items:baseline; justify-content:space-between; margin-bottom:10px;}
		.ao-tracker-wrap .aot-section-title{font-size:12.5px; font-weight:700; color:var(--aot-ink-faint); text-transform:uppercase; letter-spacing:.05em;}
		.ao-tracker-wrap .aot-result-count{font-size:12.5px; color:var(--aot-ink-faint);}
		.ao-tracker-wrap .aot-table-scroll{background:var(--aot-panel); border:1px solid var(--aot-line); border-radius:var(--aot-radius); box-shadow:var(--aot-shadow); overflow-x:auto;}
		.ao-tracker-wrap table.aot-status-table{width:100%; border-collapse:collapse; font-size:13px; min-width:2180px;}
		.ao-tracker-wrap .aot-status-table thead th{
			text-align:left; font-size:10.5px; font-weight:700; color:var(--aot-ink-soft); text-transform:uppercase;
			letter-spacing:.03em; padding:12px; border-bottom:1px solid var(--aot-line); white-space:nowrap;
			background:linear-gradient(180deg,#F3F5FC 0%,#FAFBFC 100%);
		}
		/* NEW: "Sales Order" column widened so SO numbers no longer clip
		   or wrap awkwardly. */
		.ao-tracker-wrap .aot-so-col{ min-width:160px; }
		/* NEW: the grey vertical divider that used to run down every body
		   row between column groups (MR|PO|SCO|...) is gone — the colored
		   3px bar under each group's header (set inline, see markup()) is
		   the only separator now. */
		.ao-tracker-wrap .aot-status-table tbody td{padding:12px; border-bottom:1px solid var(--aot-line-soft); vertical-align:middle;}
		.ao-tracker-wrap .aot-status-table tbody tr:nth-child(even){background:#FBFCFE;}
		.ao-tracker-wrap .aot-status-table tbody tr:hover{background:var(--aot-accent-soft);}
		.ao-tracker-wrap .aot-status-table tbody tr:last-child td{border-bottom:none;}
		.ao-tracker-wrap .aot-ao-link{color:var(--aot-accent); font-weight:700; cursor:pointer; text-decoration:none; font-size:13px;}
		.ao-tracker-wrap .aot-ao-link:hover{text-decoration:underline;}
		.ao-tracker-wrap .aot-project-name{font-size:11px; color:var(--aot-ink-faint);}
		.ao-tracker-wrap .aot-customer-cell{font-weight:500; color:var(--aot-ink-soft); max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
		.ao-tracker-wrap .aot-pending-cell{color:var(--aot-ink-soft); font-size:12.5px; max-width:200px;}
		.ao-tracker-wrap .aot-pending-chip{display:inline-block; max-width:190px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:middle; background:var(--aot-amber-bg); color:var(--aot-amber-ink); padding:4px 10px; border-radius:999px; font-size:11.5px; font-weight:700;}
		.ao-tracker-wrap .aot-pending-chip.aot-chip-completed{background:var(--aot-green-bg); color:var(--aot-green-ink);}
		.ao-tracker-wrap .aot-doc-link{font-weight:700; font-size:12px; cursor:pointer;}
		.ao-tracker-wrap .aot-doc-link:hover{text-decoration:underline;}
		/* NEW: the "N Sales Invoices" chip shown when a project has more
		   than one document of a type. */
		.ao-tracker-wrap .aot-doc-multi{
			display:inline-flex; align-items:center; gap:5px; font-weight:700; font-size:12px;
			padding:5px 11px; border:1.5px solid; border-radius:999px; cursor:pointer;
			background:var(--aot-panel); transition:filter .15s ease, transform .15s ease;
		}
	
		.ao-tracker-wrap .aot-doc-multi:hover{ filter:brightness(0.95); transform:translateY(-1px); }
		/* FIX: status pills (e.g. "To Receive and Bill") were wrapping
		   onto 2 lines inside table cells. white-space:nowrap keeps every
		   pill on one line; the table already scrolls horizontally
		   (.aot-table-scroll), so a wider pill just takes its own space
		   instead of breaking. */
		.ao-tracker-wrap .aot-mini-pill{display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:999px; font-size:11.5px; font-weight:700; white-space:nowrap;}
		.ao-tracker-wrap .aot-pri-closed{background:var(--aot-gray-bg); color:var(--aot-gray-ink);}
		/* NEW: Priority column — replaces the old Stage timeline + Severity
		   badge with a single badge computed from days-left-to-delivery. */
		.ao-tracker-wrap .aot-priority-col{ min-width:110px; }
		.ao-tracker-wrap .aot-pri-badge{display:inline-flex; align-items:center; padding:4px 12px; border-radius:999px; font-size:11.5px; font-weight:800; text-transform:uppercase; white-space:nowrap;}
		.ao-tracker-wrap .aot-pri-low{background:var(--aot-green-bg); color:var(--aot-green-ink);}
		.ao-tracker-wrap .aot-pri-medium{background:var(--aot-amber-bg); color:var(--aot-amber-ink);}
		.ao-tracker-wrap .aot-pri-high{background:var(--aot-orange-bg); color:var(--aot-orange-ink);}
		.ao-tracker-wrap .aot-pri-urgent{background:var(--aot-red-bg); color:var(--aot-red-ink);}
		.ao-tracker-wrap .aot-pri-overdue{background:var(--aot-overdue-bg); color:var(--aot-overdue-ink);}

		.ao-tracker-wrap .aot-view-btn{border:1px solid var(--aot-line); background:var(--aot-panel); color:var(--aot-ink-soft); width:28px; height:28px; border-radius:8px; cursor:pointer;}
		.ao-tracker-wrap .aot-view-btn:hover{background:var(--aot-accent-soft); border-color:var(--aot-accent); color:var(--aot-accent);}
		.ao-tracker-wrap .aot-empty-row{text-align:center; padding:40px 20px; color:var(--aot-ink-faint); font-size:13.5px;}

		.ao-tracker-wrap .aot-back-link{display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:600; color:var(--aot-ink-soft); cursor:pointer; border:none; background:none; padding:0; margin-bottom:14px;}
		.ao-tracker-wrap .aot-back-link:hover{color:var(--aot-accent);}
		.ao-tracker-wrap .aot-detail-header{display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; gap:16px; flex-wrap:wrap;}
		.ao-tracker-wrap .aot-detail-title-block h1{font-size:19px; margin:0 0 4px;}
		.ao-tracker-wrap .aot-detail-title-block .aot-d-sub{font-size:13px; color:var(--aot-ink-faint);}
		.ao-tracker-wrap .aot-d-status-pill{font-size:13px; padding:6px 14px;}
		.ao-tracker-wrap .aot-panel{background:var(--aot-panel); border:1px solid var(--aot-line); border-radius:var(--aot-radius); box-shadow:var(--aot-shadow); margin-bottom:18px; overflow:hidden;}
		.ao-tracker-wrap .aot-panel-head{padding:14px 16px; border-bottom:1px solid var(--aot-line-soft); display:flex; align-items:center; justify-content:space-between; cursor:pointer;}
		.ao-tracker-wrap .aot-panel.collapsed .aot-panel-head{border-bottom:none;}
		.ao-tracker-wrap .aot-panel.collapsed .aot-panel-body{display:none;}
		.ao-tracker-wrap .aot-caret{color:var(--aot-ink-faint); transition:transform .15s;}
		.ao-tracker-wrap .aot-panel.collapsed .aot-caret{transform:rotate(-90deg);}
		.ao-tracker-wrap .aot-panel-title{font-size:14px; font-weight:700;}
		.ao-tracker-wrap .aot-panel-desc{font-size:12px; color:var(--aot-ink-faint); margin-top:2px;}
		.ao-tracker-wrap .aot-panel-body{padding:16px;}
		.ao-tracker-wrap .aot-stat-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px;}
		.ao-tracker-wrap .aot-stat-card{background:#FBFBFD; border:1px solid var(--aot-line); border-radius:11px; padding:14px 15px;}
		.ao-tracker-wrap .aot-stat-card.aot-highlight{background:var(--aot-accent-soft); border-color:#C9D3F5;}
		.ao-tracker-wrap .aot-stat-label{font-size:10.5px; font-weight:700; color:var(--aot-ink-faint); text-transform:uppercase; margin-bottom:6px;}
		.ao-tracker-wrap .aot-stat-value{font-size:20px; font-weight:800;}
		.ao-tracker-wrap .aot-stat-value.aot-positive{color:var(--aot-green-ink);}
		.ao-tracker-wrap .aot-stat-value.aot-negative{color:var(--aot-red-ink);}
		.ao-tracker-wrap .aot-stat-sub{font-size:11px; color:var(--aot-ink-faint); margin-top:4px;}
		/* Enhanced scrollable table with styled scrollbars and comfortable column widths */
		.ao-tracker-wrap .aot-table-x-scroll{
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
			padding-bottom: 8px;
		}
		.ao-tracker-wrap .aot-table-x-scroll::-webkit-scrollbar,
		.ao-tracker-wrap .aot-table-scroll::-webkit-scrollbar {
			height: 8px;
			width: 8px;
		}
		.ao-tracker-wrap .aot-table-x-scroll::-webkit-scrollbar-track,
		.ao-tracker-wrap .aot-table-scroll::-webkit-scrollbar-track {
			background: #F1F4F9;
			border-radius: 4px;
		}
		.ao-tracker-wrap .aot-table-x-scroll::-webkit-scrollbar-thumb,
		.ao-tracker-wrap .aot-table-scroll::-webkit-scrollbar-thumb {
			background: #CBD5E1;
			border-radius: 4px;
		}
		.ao-tracker-wrap .aot-table-x-scroll::-webkit-scrollbar-thumb:hover,
		.ao-tracker-wrap .aot-table-scroll::-webkit-scrollbar-thumb:hover {
			background: #94A3B8;
		}
		.ao-tracker-wrap table.aot-flat-table{
			width: 100%;
			border-collapse: collapse;
			font-size: 13px;
			min-width: 1100px;
		}
		.ao-tracker-wrap .aot-flat-table thead th{
			text-align: left;
			font-size: 11px;
			font-weight: 700;
			color: var(--aot-ink-soft);
			text-transform: uppercase;
			letter-spacing: .02em;
			padding: 11px 12px;
			border-bottom: 1.5px solid var(--aot-line);
			white-space: nowrap;
			background: #FAFBFC;
		}
		.ao-tracker-wrap .aot-flat-table thead th.aot-num,
		.ao-tracker-wrap .aot-flat-table td.aot-num{
			text-align: right;
			white-space: nowrap;
		}
		.ao-tracker-wrap .aot-flat-table tbody td{
			padding: 11px 12px;
			border-bottom: 1px solid var(--aot-line-soft);
			vertical-align: middle;
		}
		.ao-tracker-wrap .aot-flat-table tbody tr:hover{
			background: var(--aot-accent-soft);
		}
		.ao-tracker-wrap .aot-items-tbody tr.aot-group-start td{border-top:1px solid var(--aot-line-soft);}
		.ao-tracker-wrap .aot-type-badge{display:inline-flex; padding:3px 9px; border-radius:999px; font-size:10.5px; font-weight:800;}
		.ao-tracker-wrap .aot-type-fg{background:var(--aot-accent-soft); color:var(--aot-accent);}
		.ao-tracker-wrap .aot-type-rm{background:var(--aot-purple-bg); color:var(--aot-purple-ink);}
		.ao-tracker-wrap .aot-fg-name{font-weight:600; font-size:13px;}
		.ao-tracker-wrap .aot-fg-code{font-size:11px; color:var(--aot-ink-faint); margin-top:1px;}
		.ao-tracker-wrap .aot-doc-catalog-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:14px;}
		.ao-tracker-wrap .aot-doc-card{position:relative; background:var(--aot-panel); border:1.5px solid var(--aot-line); border-radius:11px; padding:14px; cursor:pointer; transition:.15s;}
		.ao-tracker-wrap .aot-doc-card:hover{transform:translateY(-2px); box-shadow:var(--aot-shadow);}
		.ao-tracker-wrap .aot-doc-card.empty{cursor:default; border-style:dashed; background:#FBFBFD;}
		.ao-tracker-wrap .aot-doc-card.empty:hover{transform:none; box-shadow:none;}
		.ao-tracker-wrap .aot-doc-count-badge{position:absolute; top:-8px; right:-8px; min-width:20px; height:20px; padding:0 5px; border-radius:999px; font-size:10.5px; font-weight:800; display:flex; align-items:center; justify-content:center;}
		.ao-tracker-wrap .aot-count-zero{background:var(--aot-gray-bg); color:var(--aot-ink-faint);}
		.ao-tracker-wrap .aot-count-pos{background:var(--aot-red-bg); color:var(--aot-red-ink);}
		.ao-tracker-wrap .aot-doc-type-label{font-size:11px; font-weight:700; color:var(--aot-ink-faint); text-transform:uppercase; margin-bottom:4px;}
		.ao-tracker-wrap .aot-doc-code{font-weight:700; font-size:13px; margin-bottom:9px; word-break:break-word;}
		.ao-tracker-wrap .aot-doc-code.empty{color:var(--aot-ink-faint); font-weight:600;}
		.ao-tracker-wrap .aot-open-link{font-size:11px; font-weight:600; color:var(--aot-accent); margin-top:8px;}

		.ao-tracker-wrap .aot-modal-backdrop, .ao-tracker-wrap .aot-doclist-backdrop{display:none; position:fixed; inset:0; background:rgba(20,24,40,.45); z-index:1200; align-items:center; justify-content:center; padding:20px;}
		.ao-tracker-wrap .aot-modal-backdrop.open, .ao-tracker-wrap .aot-doclist-backdrop.open{display:flex;}
		.ao-tracker-wrap .aot-modal, .ao-tracker-wrap .aot-doclist-modal{background:var(--aot-panel); border-radius:14px; width:100%; max-width:560px; max-height:80vh; overflow-y:auto; padding:20px 22px; box-shadow:0 20px 60px rgba(20,24,40,.25);}
		.ao-tracker-wrap .aot-modal-head{display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:16px;}
		.ao-tracker-wrap .aot-modal-eyebrow{font-size:11px; font-weight:700; color:var(--aot-ink-faint); text-transform:uppercase; margin-bottom:4px;}
		.ao-tracker-wrap .aot-modal-title{font-size:17px; font-weight:800;}
		.ao-tracker-wrap .aot-modal-close{border:none; background:none; font-size:22px; line-height:1; color:var(--aot-ink-faint); cursor:pointer;}
		.ao-tracker-wrap .aot-modal-stats{display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-bottom:18px;}
		.ao-tracker-wrap .aot-modal-stat{background:#FBFBFD; border:1px solid var(--aot-line); border-radius:9px; padding:10px 12px;}
		.ao-tracker-wrap .aot-modal-stat-label{font-size:10px; font-weight:700; color:var(--aot-ink-faint); text-transform:uppercase; margin-bottom:4px;}
		.ao-tracker-wrap .aot-modal-stat-value{font-size:14px; font-weight:700;}
		.ao-tracker-wrap .aot-modal-items-label{font-size:11px; font-weight:700; color:var(--aot-ink-faint); text-transform:uppercase; margin-bottom:8px;}
		.ao-tracker-wrap .aot-modal-item-row{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px; border:1px solid var(--aot-line-soft); border-radius:9px; margin-bottom:8px;}
		.ao-tracker-wrap .aot-modal-item-qty{font-size:12.5px; color:var(--aot-ink-soft); white-space:nowrap;}
		.ao-tracker-wrap .aot-modal-item-ref{font-size:12px; font-weight:700; color:var(--aot-accent); cursor:pointer; white-space:nowrap; display:inline-flex; align-items:center; gap:3px;}
		.ao-tracker-wrap .aot-modal-footer{display:flex; justify-content:flex-end; gap:8px; margin-top:18px;}

		/* NEW: doc-list modal ("N Sales Invoices" browser) */
		.ao-tracker-wrap .aot-doclist-hint{font-size:12px; color:var(--aot-ink-faint); margin-bottom:12px;}
		.ao-tracker-wrap .aot-doclist-rows{display:flex; flex-direction:column; gap:8px;}
		.ao-tracker-wrap .aot-doclist-row{display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--aot-line-soft); border-radius:9px; cursor:pointer; background:#FBFBFD; transition:background .15s ease, transform .15s ease;}
		.ao-tracker-wrap .aot-doclist-row:hover{background:var(--aot-accent-soft); transform:translateX(2px);}
		.ao-tracker-wrap .aot-doclist-dot{width:8px; height:8px; border-radius:50%; flex-shrink:0;}
		.ao-tracker-wrap .aot-doclist-name{font-weight:700; font-size:13px; flex:1;}
		.ao-tracker-wrap .aot-doclist-arrow{color:var(--aot-ink-faint); display:flex; align-items:center;}
		`;
	}
}