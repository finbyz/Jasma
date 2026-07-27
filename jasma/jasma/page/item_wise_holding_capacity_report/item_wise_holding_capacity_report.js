// Copyright (c) 2026, FinByz Tech and contributors
// For license information, please see license.txt

frappe.pages['item-wise-holding-capacity-report'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Item-wise Holding Capacity',
		single_column: true,
	});

	new ItemWiseHoldingCapacity(page);
};

class ItemWiseHoldingCapacity {
	constructor(page) {
		this.page = page;
		this.method =
			'jasma.jasma.page.item_wise_holding_capacity_report.item_wise_holding_capacity_report.get_dashboard_data';

		this.theme_storage_key = 'iwhc_theme';
		this.palette_storage_key = 'iwhc_palette';

		// which extra filter fields are visible for each view
		this.view_fields = {
			'Item Wise': ['item', 'sales_person'],
			'Customer Wise': ['customer', 'sales_person'],
			Region: ['territory'],
			'Sales Person': ['sales_person'],
			Comparison: ['customer', 'item'],
		};

		this.required_hint = {
			Comparison: 'Select a Customer above to load the comparison.',
		};

		this.debounced_refresh = frappe.utils.debounce(() => this.refresh(), 400);

		this.inject_styles();
		this.make_layout();
		this.init_theme();
		this.init_palette();
		this.make_filters();
		this.apply_view_visibility();
		this.refresh();
	}

	// -------------------------------------------------------------------
	// Icons — small hand-drawn line icons (stroke = currentColor), no
	// external icon library dependency.
	// -------------------------------------------------------------------
	icon(name) {
		const icons = {
			rows: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/></svg>',
			qty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
			amount: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 8.5h4"/><path d="M9.5 11.5h4"/><path d="M9.5 8.5c0 1.8 1.6 3 3.5 3-1.9 0-3.5 1.2-3.5 3"/><path d="M9.5 14.5h1.7"/></svg>',
			chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
			table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="10" x2="9" y2="20"/></svg>',
			moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
			sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="6.3" y2="6.3"/><line x1="17.7" y1="17.7" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="6.3" y2="17.7"/><line x1="17.7" y1="6.3" x2="19.1" y2="4.9"/></svg>',
			refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
			droplet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2s7 8.5 7 13a7 7 0 0 1-14 0c0-4.5 7-13 7-13z"/></svg>',
			contrast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>',
		};
		return icons[name] || icons.chart;
	}

	icon_for_label(label) {
		const l = (label || '').toLowerCase();
		if (l.includes('row')) return 'rows';
		if (l.includes('qty') || l.includes('quantity')) return 'qty';
		if (l.includes('amount') || l.includes('value')) return 'amount';
		return 'chart';
	}

	// -------------------------------------------------------------------
	// Theme (light / dark), persisted per-browser
	// -------------------------------------------------------------------
	init_theme() {
		let saved = null;
		try {
			saved = localStorage.getItem(this.theme_storage_key);
		} catch (e) {
			saved = null;
		}
		this.set_theme(saved === 'dark' ? 'dark' : 'light', /*persist*/ false);
	}

	set_theme(theme, persist = true) {
		this.body.attr('data-iwhc-theme', theme);
		if (this.theme_btn) {
			this.theme_btn.html(this.icon(theme === 'dark' ? 'sun' : 'moon'));
			this.theme_btn.attr('title', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
		}
		if (persist) {
			try {
				localStorage.setItem(this.theme_storage_key, theme);
			} catch (e) {
				/* ignore storage errors */
			}
		}
		// Re-render charts so their text/line colors pick up the new theme
		if (this.last_chart) this.render_chart(this.last_chart);
		if (this.last_chart2) this.render_chart2(this.last_chart2);
	}

	toggle_theme() {
		const current = this.body.attr('data-iwhc-theme') === 'dark' ? 'dark' : 'light';
		this.set_theme(current === 'dark' ? 'light' : 'dark');
	}

	// -------------------------------------------------------------------
	// Palette (Color / Black & White) — independent of the theme toggle
	// -------------------------------------------------------------------
	init_palette() {
		let saved = null;
		try {
			saved = localStorage.getItem(this.palette_storage_key);
		} catch (e) {
			saved = null;
		}
		this.set_palette(saved === 'mono' ? 'mono' : 'color', /*persist*/ false);
	}

	set_palette(palette, persist = true) {
		this.body.attr('data-iwhc-palette', palette);
		if (this.palette_btn) {
			this.palette_btn.html(this.icon(palette === 'mono' ? 'contrast' : 'droplet'));
			this.palette_btn.attr('title', palette === 'mono' ? 'Switch to color' : 'Switch to black & white');
		}
		if (persist) {
			try {
				localStorage.setItem(this.palette_storage_key, palette);
			} catch (e) {
				/* ignore storage errors */
			}
		}
		if (this.last_chart) this.render_chart(this.last_chart);
		if (this.last_chart2) this.render_chart2(this.last_chart2);
	}

	toggle_palette() {
		const current = this.body.attr('data-iwhc-palette') === 'mono' ? 'mono' : 'color';
		this.set_palette(current === 'mono' ? 'color' : 'mono');
	}

	// Resolve the current theme + palette into a concrete chart color set
	get_chart_colors(chart_type) {
		const theme = this.body.attr('data-iwhc-theme') === 'dark' ? 'dark' : 'light';
		const palette = this.body.attr('data-iwhc-palette') === 'mono' ? 'mono' : 'color';

		const sets = {
			color: {
				light: {
					donut: ['#6366F1', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#0EA5E9', '#EC4899'],
					bar: ['#6366F1'],
				},
				dark: {
					donut: ['#818CF8', '#34D399', '#FBBF24', '#A78BFA', '#F87171', '#38BDF8', '#F472B6'],
					bar: ['#818CF8'],
				},
			},
			mono: {
				light: {
					donut: ['#111827', '#374151', '#6B7280', '#9CA3AF', '#D1D5DB', '#4B5563', '#1F2937'],
					bar: ['#111827'],
				},
				dark: {
					donut: ['#FFFFFF', '#D1D5DB', '#9CA3AF', '#6B7280', '#4B5563', '#E5E7EB', '#C7CBD4'],
					bar: ['#FFFFFF'],
				},
			},
		};

		const set = sets[palette][theme];
		return chart_type === 'donut' ? set.donut : set.bar;
	}

	inject_styles() {
		if (document.getElementById('iwhc-styles')) return;
		const style = document.createElement('style');
		style.id = 'iwhc-styles';
		style.innerHTML = `
			@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

			.iwhc-wrapper {
				--iwhc-bg: #f3f4f6;
				--iwhc-surface: #ffffff;
				--iwhc-surface-alt: #eef0f3;
				--iwhc-border: #e5e7eb;
				--iwhc-text: #111827;
				--iwhc-text-2: #374151;
				--iwhc-text-muted: #6b7280;
				--iwhc-accent: #6366f1;
				--iwhc-accent-dark: #4f46e5;
				--iwhc-accent-soft: rgba(99,102,241,0.10);
				--iwhc-blue: #3b82f6;
				--iwhc-blue-soft: rgba(59,130,246,0.12);
				--iwhc-violet: #8b5cf6;
				--iwhc-violet-soft: rgba(139,92,246,0.12);
				--iwhc-emerald: #10b981;
				--iwhc-emerald-soft: rgba(16,185,129,0.12);
				--iwhc-shadow: 0 1px 2px rgba(16,24,40,0.04), 0 4px 12px -4px rgba(16,24,40,0.06);
				--iwhc-shadow-hover: 0 2px 4px rgba(16,24,40,0.05), 0 12px 24px -8px rgba(16,24,40,0.12);
				--iwhc-hover-border: #dfe3ea;

				padding: 10px 2px 30px;
				background: var(--iwhc-bg);
				font-family: 'Inter', -apple-system, sans-serif;
				transition: background .2s ease;
				-webkit-font-smoothing: antialiased;
			}
			.iwhc-wrapper[data-iwhc-theme="dark"] {
				--iwhc-bg: #14161f;
				--iwhc-surface: #1c1f2b;
				--iwhc-surface-alt: #20232f;
				--iwhc-border: #2c2f3d;
				--iwhc-text: #f3f4f6;
				--iwhc-text-2: #cbd0dc;
				--iwhc-text-muted: #8b8fa3;
				--iwhc-accent: #6366f1;
				--iwhc-accent-dark: #818cf8;
				--iwhc-accent-soft: rgba(99,102,241,0.18);
				--iwhc-blue: #60a5fa;
				--iwhc-blue-soft: rgba(96,165,250,0.18);
				--iwhc-violet: #a78bfa;
				--iwhc-violet-soft: rgba(167,139,250,0.18);
				--iwhc-emerald: #34d399;
				--iwhc-emerald-soft: rgba(52,211,153,0.18);
				--iwhc-shadow: 0 1px 2px rgba(0,0,0,0.3);
				--iwhc-shadow-hover: 0 6px 18px rgba(0,0,0,0.4);
				--iwhc-hover-border: #3a3f52;
			}

			/* Black & White palette — overrides all accent colors, keeps
			   the light/dark surface & text colors untouched */
			.iwhc-wrapper[data-iwhc-palette="mono"] {
				--iwhc-accent: #111827;
				--iwhc-accent-dark: #111827;
				--iwhc-accent-soft: rgba(17,24,39,0.08);
				--iwhc-blue: #111827;
				--iwhc-blue-soft: rgba(17,24,39,0.08);
				--iwhc-violet: #374151;
				--iwhc-violet-soft: rgba(55,65,81,0.10);
				--iwhc-emerald: #4b5563;
				--iwhc-emerald-soft: rgba(75,85,99,0.10);
			}
			.iwhc-wrapper[data-iwhc-theme="dark"][data-iwhc-palette="mono"] {
				--iwhc-accent: #ffffff;
				--iwhc-accent-dark: #ffffff;
				--iwhc-accent-soft: rgba(255,255,255,0.14);
				--iwhc-blue: #ffffff;
				--iwhc-blue-soft: rgba(255,255,255,0.14);
				--iwhc-violet: #d1d5db;
				--iwhc-violet-soft: rgba(255,255,255,0.10);
				--iwhc-emerald: #9ca3af;
				--iwhc-emerald-soft: rgba(255,255,255,0.08);
			}

			.iwhc-filters-card {
				background: var(--iwhc-surface);
				border: 1px solid var(--iwhc-border);
				border-radius: 12px;
				box-shadow: 0 1px 3px rgba(0,0,0,0.06);
				padding: 12px 18px;
				margin-bottom: 12px;
				display: flex;
				flex-wrap: wrap;
				gap: 18px;
				align-items: flex-end;
			}
			.iwhc-filters-card .iwhc-field { min-width: 170px; }
			.iwhc-filters-card .frappe-control { margin-bottom: 0; }
			.iwhc-filters-card .frappe-control label,
			.iwhc-filters-card .control-label { color: var(--iwhc-text-muted); }
			.iwhc-filters-card input, .iwhc-filters-card select {
				background: var(--iwhc-bg) !important;
				color: var(--iwhc-text) !important;
				border-color: var(--iwhc-border) !important;
			}

			.iwhc-actions { margin-left: auto; display: flex; gap: 8px; align-self: flex-end; }
			.iwhc-icon-btn {
				width: 32px; height: 32px; border-radius: 8px;
				border: 1px solid var(--iwhc-border);
				background: var(--iwhc-surface);
				color: var(--iwhc-text-2);
				display: flex; align-items: center; justify-content: center;
				cursor: pointer; transition: all .15s ease;
			}
			.iwhc-icon-btn svg { width: 16px; height: 16px; }
			.iwhc-icon-btn:hover { background: var(--iwhc-bg); border-color: var(--iwhc-accent); color: var(--iwhc-text); }
			.iwhc-icon-btn:active { transform: scale(.94); }

			.iwhc-hint {
				font-size: 12.5px;
				color: var(--iwhc-text-muted);
				margin: 0 0 20px 4px;
				display: flex;
				align-items: center;
				gap: 6px;
			}
			.iwhc-hint.iwhc-hint-hidden { display: none; }

			.iwhc-cards-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
				gap: 16px;
				margin-bottom: 20px;
			}
			.iwhc-card {
				position: relative;
				background: var(--iwhc-surface);
				border: 1px solid var(--iwhc-border);
				border-radius: 16px;
				padding: 22px 24px;
				box-shadow: var(--iwhc-shadow);
				display: flex;
				align-items: flex-start;
				gap: 16px;
				transition: transform .25s cubic-bezier(.16,1,.3,1), box-shadow .25s ease, border-color .25s ease;
			}
			.iwhc-card:hover {
				box-shadow: var(--iwhc-shadow-hover);
				transform: translateY(-2px);
				border-color: var(--iwhc-hover-border);
			}
			.iwhc-card-icon {
				flex: none;
				width: 44px; height: 44px;
				border-radius: 12px;
				display: flex; align-items: center; justify-content: center;
				background: var(--iwhc-accent-soft); color: var(--iwhc-accent);
			}
			.iwhc-card-icon svg { width: 22px; height: 22px; }
			.iwhc-card .iwhc-label {
				font-size: 11.5px; color: var(--iwhc-text-muted); text-transform: uppercase;
				letter-spacing: .7px; font-weight: 700;
			}
			.iwhc-card .iwhc-value {
				font-size: 30px; font-weight: 800; margin-top: 8px; line-height: 1.15;
				color: var(--iwhc-text); font-variant-numeric: tabular-nums;
			}
			.iwhc-c1 .iwhc-card-icon { background: var(--iwhc-blue-soft); color: var(--iwhc-blue); }
			.iwhc-c2 .iwhc-card-icon { background: var(--iwhc-violet-soft); color: var(--iwhc-violet); }
			.iwhc-c3 .iwhc-card-icon { background: var(--iwhc-emerald-soft); color: var(--iwhc-emerald); }

			.iwhc-stack { display: flex; flex-direction: column; gap: 16px; }

			.iwhc-panel {
				background: var(--iwhc-surface);
				border: 1px solid var(--iwhc-border);
				border-radius: 16px;
				box-shadow: var(--iwhc-shadow);
				padding: 20px 22px;
				width: 100%;
				box-sizing: border-box;
				transition: border-color .25s ease;
			}
			.iwhc-panel-head {
				display: flex; align-items: center; gap: 10px;
				margin: 0 0 16px;
				padding-bottom: 14px;
				border-bottom: 1px solid var(--iwhc-border);
			}
			.iwhc-panel-head .iwhc-panel-icon {
				width: 28px; height: 28px; border-radius: 8px;
				background: var(--iwhc-accent-soft); color: var(--iwhc-accent);
				display: flex; align-items: center; justify-content: center; flex: none;
			}
			.iwhc-panel-head .iwhc-panel-icon svg { width: 15px; height: 15px; }
			.iwhc-panel-head h6 {
				margin: 0;
				font-weight: 700; color: var(--iwhc-text);
				font-size: 12px; letter-spacing: .5px; text-transform: uppercase;
			}

			.iwhc-chart-panel .iwhc-chart,
			.iwhc-chart-panel .iwhc-chart2 { width: 100%; min-height: 300px; }
			.iwhc-chart-panel.iwhc-chart-compact { padding-bottom: 8px; }
			.iwhc-chart-panel.iwhc-chart-compact .iwhc-chart { min-height: 220px; }

			/* Frappe Charts themes itself via these custom properties (see
			   frappe-charts.min.css) - overriding the wrong class names here
			   silently did nothing before, which is why grid lines stayed a
			   hardcoded near-white (#f4f5f6) and blazed across the dark bg. */
			.iwhc-wrapper .chart-container {
				--charts-label-color: var(--iwhc-text-muted);
				--charts-axis-line-color: var(--iwhc-border);
				--charts-tooltip-title: var(--iwhc-text);
				--charts-tooltip-label: var(--iwhc-text-muted);
				--charts-tooltip-value: var(--iwhc-text);
				--charts-tooltip-bg: var(--iwhc-surface);
			}
			.iwhc-wrapper .graph-svg-tip {
				box-shadow: 0 4px 14px rgba(0,0,0,0.16);
				border: 1px solid var(--iwhc-border);
			}

			.iwhc-empty {
				text-align: center; padding: 60px 10px; color: var(--iwhc-text-muted); font-size: 13px;
			}
			.iwhc-table-wrapper .dt-scrollable { border-radius: 10px; }

			/* frappe-datatable themes itself via these --dt-* custom
			   properties (see frappe-datatable.css). Scoping them here -
			   instead of guessing at .dt-row/.dt-header class names that
			   don't exist in the library - is what actually makes row
			   backgrounds and text follow the page theme; previously rows
			   stayed on the library's hardcoded white with near-white text
			   forced onto them, which is why data looked washed out. */
			.iwhc-table-wrapper .datatable {
				--dt-border-color: var(--iwhc-border);
				--dt-cell-bg: var(--iwhc-surface);
				--dt-header-cell-bg: var(--iwhc-surface-alt);
				--dt-text-color: var(--iwhc-text);
				--dt-text-light: var(--iwhc-text-muted);
				--dt-light-bg: var(--iwhc-surface-alt);
				--dt-selection-highlight-color: var(--iwhc-accent-soft);
				--dt-primary-color: var(--iwhc-accent);
			}

			/* Frappe's own desk CSS (frappe_datatable.scss) hardcodes a few
			   spots straight to Frappe's site-wide theme tokens instead of
			   going through the --dt-* variables above - it forces cell text
			   to var(--text-color) with !important, and sets the header row
			   and filter-row inputs to var(--subtle-fg)/var(--control-bg).
			   Those follow Frappe's own desk theme, not this page's toggle,
			   which is why the header/filter row stayed light and the row
			   text stayed a washed-out grey. Beat them here with matching or
			   higher specificity. */
			.iwhc-table-wrapper .dt-cell {
				color: var(--iwhc-text) !important;
			}
			.iwhc-table-wrapper .dt-header .dt-row-header,
			.iwhc-table-wrapper .dt-cell--header .dt-cell__content {
				background-color: var(--iwhc-surface-alt) !important;
				color: var(--iwhc-text) !important;
			}
			.iwhc-table-wrapper .dt-row-filter .dt-filter.dt-input {
				background-color: var(--iwhc-surface) !important;
				color: var(--iwhc-text) !important;
			}
		`;
		document.head.appendChild(style);
	}

	make_layout() {
		this.page.main.append('<div class="iwhc-wrapper"></div>');
		this.body = this.page.main.find('.iwhc-wrapper');

		this.filter_wrapper = $('<div class="iwhc-filters-card"></div>').appendTo(this.body);
		this.hint_wrapper = $('<div class="iwhc-hint iwhc-hint-hidden"></div>').appendTo(this.body);
		this.cards_grid = $('<div class="iwhc-cards-grid"></div>').appendTo(this.body);

		// Chart gets its own full-width panel so it can breathe; the
		// detail table sits full-width below it.
		this.stack = $('<div class="iwhc-stack"></div>').appendTo(this.body);

		this.chart_panel = $('<div class="iwhc-panel iwhc-chart-panel"></div>').appendTo(this.stack);
		$(`<div class="iwhc-panel-head"><div class="iwhc-panel-icon">${this.icon('chart')}</div><h6 class="iwhc-chart-title">Chart</h6></div>`).appendTo(this.chart_panel);
		$('<div class="iwhc-chart"></div>').appendTo(this.chart_panel);

		this.chart2_panel = $('<div class="iwhc-panel iwhc-chart-panel" style="display:none;"></div>').appendTo(this.stack);
		$(`<div class="iwhc-panel-head"><div class="iwhc-panel-icon">${this.icon('chart')}</div><h6 class="iwhc-chart2-title">Breakdown</h6></div>`).appendTo(this.chart2_panel);
		$('<div class="iwhc-chart2"></div>').appendTo(this.chart2_panel);

		this.table_panel = $('<div class="iwhc-panel iwhc-table-wrapper"></div>').appendTo(this.stack);
		$(`<div class="iwhc-panel-head"><div class="iwhc-panel-icon">${this.icon('table')}</div><h6>Detail</h6></div>`).appendTo(this.table_panel);
		$('<div class="iwhc-table"></div>').appendTo(this.table_panel);
	}

	make_filters() {
		const field_defs = [
			{
				fieldname: 'view',
				label: 'View',
				fieldtype: 'Select',
				options: ['Item Wise', 'Customer Wise', 'Sales Person', 'Region', 'Comparison'],
				default: 'Item Wise',
			},
			{
				fieldname: 'from_date',
				label: 'From Date',
				fieldtype: 'Date',
				default: frappe.datetime.add_months(frappe.datetime.get_today(), -1),
			},
			{ fieldname: 'to_date', label: 'To Date', fieldtype: 'Date', default: frappe.datetime.get_today() },
			{ fieldname: 'item', label: 'Item', fieldtype: 'Link', options: 'Item' },
			{ fieldname: 'customer', label: 'Customer', fieldtype: 'Link', options: 'Customer' },
			{ fieldname: 'sales_person', label: 'Sales Person', fieldtype: 'Link', options: 'Sales Person' },
			{ fieldname: 'territory', label: 'Region (Territory)', fieldtype: 'Link', options: 'Territory' },
		];

		this.controls = {};
		field_defs.forEach((df) => {
			const $f = $('<div class="iwhc-field"></div>').appendTo(this.filter_wrapper);
			const ctrl = frappe.ui.form.make_control({ df, parent: $f, render_input: true });
			ctrl.refresh();
			if (df.default) ctrl.set_value(df.default);
			ctrl.$wrapper = $f;
			this.controls[df.fieldname] = ctrl;

			// auto-run on any change
			if (ctrl.$input) {
				ctrl.$input.on('change awesomplete-selectcomplete', () => {
					if (df.fieldname === 'view') this.apply_view_visibility();
					this.debounced_refresh();
				});
			}
		});

		// Theme toggle + palette toggle + manual refresh, right-aligned in the filter bar
		this.actions_wrapper = $('<div class="iwhc-actions"></div>').appendTo(this.filter_wrapper);
		this.palette_btn = $(`<button type="button" class="iwhc-icon-btn" title="Toggle color palette">${this.icon('droplet')}</button>`)
			.appendTo(this.actions_wrapper)
			.on('click', () => this.toggle_palette());
		this.theme_btn = $(`<button type="button" class="iwhc-icon-btn" title="Toggle theme">${this.icon('moon')}</button>`)
			.appendTo(this.actions_wrapper)
			.on('click', () => this.toggle_theme());
		this.refresh_btn = $(`<button type="button" class="iwhc-icon-btn" title="Refresh">${this.icon('refresh')}</button>`)
			.appendTo(this.actions_wrapper)
			.on('click', () => this.refresh());

		// Buttons were created after init_theme()/init_palette() ran, so
		// sync their icon/title to the already-resolved state now.
		this.set_theme(this.body.attr('data-iwhc-theme') === 'dark' ? 'dark' : 'light', false);
		this.set_palette(this.body.attr('data-iwhc-palette') === 'mono' ? 'mono' : 'color', false);
	}

	apply_view_visibility() {
		const view = this.controls.view.get_value();
		const visible = this.view_fields[view] || [];

		['item', 'customer', 'sales_person', 'territory'].forEach((fname) => {
			const ctrl = this.controls[fname];
			if (!ctrl) return;
			ctrl.$wrapper.toggle(visible.includes(fname));
		});

		// Comparison always uses a fixed trailing 12-month window, so the
		// generic date range filter doesn't apply there.
		const is_comparison = view === 'Comparison';
		['from_date', 'to_date'].forEach((fname) => {
			const ctrl = this.controls[fname];
			if (!ctrl) return;
			ctrl.$wrapper.toggle(!is_comparison);
		});

		// Customer is mandatory once Comparison is selected
		if (this.controls.customer) {
			this.controls.customer.df.reqd = is_comparison ? 1 : 0;
			this.controls.customer.refresh();
		}

		const hint = this.required_hint[view];
		if (hint) {
			this.hint_wrapper.text(`ℹ ${hint}`).removeClass('iwhc-hint-hidden');
		} else {
			this.hint_wrapper.addClass('iwhc-hint-hidden');
		}
	}

	get_filter_values() {
		// Only send filters that are actually relevant/visible for the
		// current view. Otherwise a stale value left over in a hidden
		// field (e.g. Item picked while on "Item Wise") would silently
		// keep filtering results after switching to another view like
		// "Sales Person", making it look like there's no data.
		const view = this.controls.view.get_value();
		const visible_extra = this.view_fields[view] || [];
		const base = view === 'Comparison' ? ['view'] : ['view', 'from_date', 'to_date'];
		const relevant = base.concat(visible_extra);

		const values = {};
		relevant.forEach((k) => {
			if (this.controls[k]) values[k] = this.controls[k].get_value();
		});
		return values;
	}

	refresh() {
		const filters = this.get_filter_values();
		this.page.set_indicator('Loading...', 'orange');

		frappe.call({
			method: this.method,
			args: { filters },
			callback: (r) => {
				const res = r.message || {};
				this.current_columns = res.columns || [];
				this.render_cards(res.summary || []);
				this.render_chart(res.chart || {});
				this.render_chart2(res.chart2 || null);
				this.render_table(res.data || [], this.current_columns);
				this.page.set_indicator('Updated', 'green');
			},
			error: () => {
				this.page.set_indicator('Error', 'red');
			},
		});
	}

	render_cards(summary) {
		const classes = ['iwhc-c1', 'iwhc-c2', 'iwhc-c3'];
		this.cards_grid.empty();

		summary.forEach((s, i) => {
			let val = s.value;
			if (s.datatype === 'Currency') val = format_currency(s.value);
			else if (s.datatype === 'Float') val = flt(s.value, 2);

			this.cards_grid.append(`
				<div class="iwhc-card ${classes[i % classes.length]}">
					<div class="iwhc-card-icon">${this.icon(this.icon_for_label(s.label))}</div>
					<div class="iwhc-card-body">
						<div class="iwhc-label">${frappe.utils.escape_html(s.label)}</div>
						<div class="iwhc-value">${val}</div>
					</div>
				</div>
			`);
		});
	}

	render_chart(chart) {
		this.last_chart = chart;
		const $chart = this.chart_panel.find('.iwhc-chart').empty();
		this.chart_panel.find('.iwhc-chart-title').text(chart.title || 'Chart');

		const is_donut = chart.type === 'donut';
		this.chart_panel.toggleClass('iwhc-chart-compact', is_donut);

		if (!chart.labels || !chart.labels.length) {
			$chart.append('<div class="iwhc-empty">No data to chart</div>');
			return;
		}

		const colors = this.get_chart_colors(chart.type);
		const chart_height = is_donut ? 260 : 340;

		new frappe.Chart($chart[0], {
			data: {
				labels: chart.labels,
				datasets: [{ values: chart.values }],
			},
			type: chart.type || 'bar',
			height: chart_height,
			colors,
		});
	}

	render_chart2(chart) {
		this.last_chart2 = chart;

		if (!chart || !chart.labels || !chart.labels.length) {
			this.chart2_panel.hide();
			return;
		}
		this.chart2_panel.show();

		const $chart = this.chart2_panel.find('.iwhc-chart2').empty();
		this.chart2_panel.find('.iwhc-chart2-title').text(chart.title || 'Breakdown');

		const is_donut = chart.type === 'donut';
		this.chart2_panel.toggleClass('iwhc-chart-compact', is_donut);

		const colors = this.get_chart_colors(chart.type);

		new frappe.Chart($chart[0], {
			data: {
				labels: chart.labels,
				datasets: [{ values: chart.values }],
			},
			type: chart.type || 'bar',
			height: is_donut ? 260 : 300,
			colors,
		});
	}

	render_table(data, columns) {
		const $table = this.table_panel.find('.iwhc-table').empty();
		if (!data.length || !columns.length) {
			$table.append('<div class="iwhc-empty">No records found</div>');
			return;
		}

		const dt_columns = columns.map((c) => c.label);
		const rows = data.map((row) =>
			columns.map((c) => {
				const val = row[c.fieldname];
				if (c.type === 'currency') return format_currency(val);
				if (c.type === 'float') return flt(val, 2);
				return val == null ? '' : val;
			})
		);

		this.datatable = new frappe.DataTable($table[0], {
			columns: dt_columns,
			data: rows,
			layout: 'fluid',
			serialNoColumn: true,
			inlineFilters: true,
		});
	}
}