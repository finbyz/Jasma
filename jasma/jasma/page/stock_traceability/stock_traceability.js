// apps/<your_app>/<your_app>/page/stock_traceability/stock_traceability.js
//
// Client controller for the "Stock Source Traceability" page.
// Data comes ONLY from stock_traceability.py (get_dn_traceability etc.) —
// nothing is hard-coded, everything is computed live from Stock Ledger Entry.
//
// Delivery Note is OPTIONAL: on load, and whenever there's no AO / Sales
// Order / Delivery Note scope active, the page fetches the most recent
// submitted Delivery Notes from the server and traces all of them (see
// get_dn_traceability in the .py). Company is an optional secondary filter
// on that fallback lookup only.
//
// AO Number -> Sales Order -> Delivery Note:
//   - Sales Order dropdown is filtered (client-side) to Sales Order.project = AO.
//     If exactly one match, it's auto-selected.
//   - Delivery Note is a custom multi-select (button + dialog — see below),
//     filtered (server-side, via dn_multiselect_query) to Delivery Notes
//     whose Delivery Note Item.project = AO.
//   - As soon as an AO is chosen, the Items/Flow/Report views trace EVERY
//     Delivery Note under that AO at once (not just one) — see
//     state.scoped_delivery_notes below. Every Delivery Note resolved for
//     that AO (or Sales Order) is auto-selected — not just when there
//     happens to be a single match — so the field always shows exactly
//     what's being traced, and the user can freely narrow it down by
//     unchecking entries in the dialog.
//
// IMPORTANT — hang/freeze/auto-refresh-loop fix:
//   A previous version set Sales Order / Delivery Note values programmatically
//   during the AO cascade using `.set_value()` while briefly nulling the
//   field's own `df.change` around that call. That does NOT actually stay
//   quiet: Frappe's Control.set_value() runs an internal async promise chain
//   and only invokes `df.change` as its LAST step — by the time that step
//   runs, the earlier code had already restored the original `df.change`, so
//   the "quiet" set fired its handler anyway a moment later. That re-fired
//   the field's own handler, which in turn fired ANOTHER server call +
//   another `fetch_and_render()` — so one AO selection could kick off 2-3
//   overlapping fetches (each freezing the page), or in the worst case a
//   genuine infinite loop: AO change -> quiet-set Sales Order -> Sales Order
//   change fires anyway -> quiet-sets AO Number back -> AO Number change
//   fires anyway -> repeat forever. Fixed by:
//     1. set_value_quiet() — uses a re-entrancy COUNTER (this._suppress_change)
//        instead of a synchronous null/restore trick. It increments before
//        calling set_value() and only decrements once that call's returned
//        promise has actually resolved, so the guard is up for the entire
//        real duration of the async update — not just its synchronous start.
//        (Delivery Note no longer needs this — it's plain state now, not a
//        Frappe control — but AO Number / Sales Order still use it.)
//     2. Every field's own `change` handler checks `this._suppress_change`
//        first and bails out immediately if it's non-zero, regardless of
//        when Frappe actually gets around to invoking the handler.
//     3. A `_fetching` guard in fetch_and_render() so a second fetch can never
//        start while one is still in flight.
//     4. frappe.call's `always` callback releases the loading state
//        unconditionally (success, error, or exception) so it can never get
//        stuck open.
//
// IMPORTANT — Delivery Note field rewrite:
//   Frappe's built-in `MultiSelectList` control silently collapses into a
//   plain text summary ("N values selected") once enough pills are added —
//   that behavior is driven by the control's own internal JS (pill
//   count / container width heuristics), NOT by CSS, so no amount of
//   styling can prevent or override it. Rather than fight that, the
//   Delivery Note field is now a small custom control: a button showing
//   "N Delivery Note(s) selected" that opens a frappe.ui.Dialog with a
//   searchable, checkmark-style row list (still backed by the same
//   server-side dn_multiselect_query). Selections live in
//   `this.state.selected_dns` (a plain array) instead of a Frappe control's
//   get_value().
//
// Period filter has been removed entirely (dropdown, custom date range, and
// all related backend logic) per requirements.
//
// IMPORTANT — Reset button:
//   A dedicated Reset button sits next to Refresh in the filter bar. It
//   clears AO Number / Sales Order / Delivery Note selections back to the
//   page's original "nothing selected" state (Company is restored to its
//   default) and re-renders the "please select a filter" prompt — exactly
//   what the page shows on first load.
//
// IMPORTANT — AO Number column + chip-style links (this revision):
//   The Items Summary table now shows a dedicated, clickable "AO Number"
//   column alongside "Delivery Note" (previously AO Number was only usable
//   as a filter, never shown per-row). Both — plus the Source Document /
//   Purchase-Sub. Order links in the Report tab — are rendered as small
//   pill-style "chips" (icon + name) via chip_link(), each with its OWN
//   colour family (AO = amber/gold, Delivery Note = blue, Source Document =
//   green, Purchase/Subcontracting Order = purple) instead of every link
//   sharing one flat colour. See chip_link() and the .st-chip-* CSS below.
//
// IMPORTANT — diagram nodes are now clickable (this revision):
//   Every node drawn in the Traceability Flow diagram (the root Delivery
//   Note node, and every Stock Entry / Purchase Receipt / Subcontracting
//   Receipt / Purchase Order / Subcontracting Order / Material Request /
//   Warehouse / Item node beneath it) now opens its underlying document on
//   click, the same way the Items Summary / Report table chips already did.
//   See node_doctype() for the title -> doctype map used to route each
//   click, and node_html() / render_diagram() for where the st-doc-link
//   class + data-name/data-doctype attributes get attached.
//
// IMPORTANT — untraced-quantity diagnostics + subcontracting RM metadata:
//   1. Untraced branches (build_branches() / trace_delivery_note_item()
//      shortfalls in the .py) now come back with `item_name`, `hint_entry`,
//      `hint_entry_type` and `hint_sle` alongside `note` — the backend has
//      already worked out WHY nothing was traced (nearest inward entry
//      exists but is dated after the delivery, or exists in a different
//      warehouse, or genuinely doesn't exist anywhere) and, where an entry
//      DOES exist, gives us its name/doctype/SLE so we can link straight to
//      it instead of dead-ending on a flat "Opening Stock" box. See the
//      untraced branch of render_subtree() and the b.untraced branch of
//      render_report().
//   2. Subcontracting Receipt "Raw Material Consumed" nodes carry a `meta`
//      block (source SLE, RM item code, RM qty consumed, and the
//      finished-good qty it covers) — see node_html(), which renders it as
//      a small panel under the node.
//
// IMPORTANT — RM meta panel simplification (this revision):
//   - The node's own headline Qty and the meta panel's "RM Qty Consumed"
//     now always show the SAME number (the backend guarantees this — see
//     resolve_subcontracting_receipt() in the .py) so there's never a
//     mismatched pair like "Qty: 532.57" next to "RM Qty Consumed: 9450".
//   - "RM Item" in the meta panel now shows just the plain Item Code (no
//     item name, not a link) — kept short and scannable.
//   - The "Ref" (Subcontracting Receipt Item reference row) line has been
//     removed entirely — it didn't add anything useful to the reader.
//
// IMPORTANT — visible tree connector lines (this revision):
//   Previously the only visual "connection" between nodes was a 1px line
//   in the theme's --st-border colour (very light grey — effectively
//   invisible against the canvas background), and there was NO line at
//   all between the root Delivery Note node and the branches below it, or
//   between sibling branches at a fork. The diagram now draws a proper,
//   clearly-visible tree: a dedicated --st-line-color (a darker slate
//   tone, tuned separately for light/dark mode) is used for every
//   connector, a vertical stem now drops from the root node down into the
//   branch row, and forking branches get a classic org-chart elbow
//   (horizontal bar + vertical stems into each sibling) instead of just
//   floating next to each other with no visible link at all.
//
// IMPORTANT — Report View restructure:
//   The Consumption Report table no longer has a "Type" (FG/Direct) column.
//   In its place is a "Delivered Qty" column. The Delivery Note / Delivered
//   Item / Delivered Qty cells are now rendered with rowspan across every
//   branch (source document) belonging to that item, instead of being
//   blanked out on "continuation" rows. The "Component / RM Consumed"
//   column always shows the component's own Item Code (as a clickable
//   link) AND its resolved Item Name — for a Direct item (no RM) this
//   mirrors the delivered item's own code/name.

frappe.pages['stock-traceability'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Stock Source Traceability',
		single_column: true
	});

	new StockTraceability(page);
};

class StockTraceability {
	constructor(page) {
		this.page = page;
		this.state = {
			items: [],
			activeIdx: 0,
			delivery_notes: [],
			// Delivery Notes implied by the current AO / Sales Order
			// selection (used when no single Delivery Note is picked).
			scoped_delivery_notes: [],
			// Delivery Notes actually selected in the custom DN dialog
			// (replaces the old dn_field MultiSelectList get_value()).
			selected_dns: [],
			// Which legend chip (if any) is currently active — clicking a
			// legend item highlights matching nodes in the diagram and
			// dims everything else. null = no filter, show everything.
			legendFilter: null,
			theme: localStorage.getItem('st_theme') || 'light'
		};
		this._fetching = false; // guards against overlapping fetch_and_render() calls
		this._suppress_change = 0; // re-entrancy guard: >0 while a quiet AO/SO cascade update is in flight
		this.default_company = 'Jasma Engineering LLP';

		this.inject_styles();
		this.render_shell();
		this.apply_theme();
		this.setup_filters();
		this.bind_shell_events();

		// At least one of AO Number / Sales Order / Delivery Note is now
		// REQUIRED before anything is traced — show the "please select"
		// prompt instead of auto-fetching recent Delivery Notes on load.
		this.render_selection_required();
	}

	/* ---------------------------------------------------------------- */
	/* theme                                                              */
	/* ---------------------------------------------------------------- */

	apply_theme() {
		this.page.main.find('.st-page').attr('data-theme', this.state.theme);
		this.page.main.find('#st-theme-toggle').html(this.icon(this.state.theme === 'dark' ? 'sun' : 'moon'));
		this.page.main.find('#st-theme-toggle').attr('title', this.state.theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
	}

	toggle_theme() {
		this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
		localStorage.setItem('st_theme', this.state.theme);
		this.apply_theme();
	}

	/* ---------------------------------------------------------------- */
	/* filters (Company, then AO / SO / DN). All optional.                */
	/* ---------------------------------------------------------------- */

	setup_filters() {
		const me = this;

		// --- Primary filter: Company (secondary narrowing on the "recent
		// DN" fallback only — ignored once AO/SO/DN gives an explicit scope) ---

		this.company_field = frappe.ui.form.make_control({
			parent: this.page.main.find('.st-field-company'),
			df: {
				fieldtype: 'Link',
				options: 'Company',
				fieldname: 'company',
				label: __('Company'),
				reqd: 0,
				default: this.default_company,
				placeholder: __('All Companies'),
				change: () => me.fetch_and_render()
			},
			render_input: true
		});
		this.attach_field_icon(this.company_field, 'home');
		// Default company — set explicitly since a standalone control (not
		// bound to a frm) doesn't auto-apply df.default on its own.
		this.company_field.set_value(this.default_company);

		// --- AO Number / Sales Order / Delivery Note ---
		// Selecting an AO Number narrows the Sales Order dropdown (client-side)
		// and the Delivery Note dialog options (server-side) to that AO's own
		// records, and immediately traces every Delivery Note under it — all
		// of which get auto-selected into state.selected_dns.

		this.ao_field = frappe.ui.form.make_control({
			parent: this.page.main.find('.st-field-ao'),
			df: {
				fieldtype: 'Link',
				options: 'Project', // ASSUMPTION: AO Number = Project. Adapt if different.
				fieldname: 'project',
				label: __('AO Number'),
				reqd: 0,
				placeholder: __('Select Assembly / Sales Order'),
				// Bail out while a programmatic (quiet) update from the AO/SO
				// cascade is still in flight — see set_value_quiet() below for
				// why this guard is required (this is what fixes the
				// AO-selection auto-refresh / infinite loop).
				change: () => { if (this._suppress_change) return; me.on_ao_change(); }
			},
			render_input: true
		});

		this.so_field = frappe.ui.form.make_control({
			parent: this.page.main.find('.st-field-so'),
			df: {
				fieldtype: 'Link',
				options: 'Sales Order',
				fieldname: 'sales_order',
				label: __('Sales Order'),
				reqd: 0,
				placeholder: __('Select Sales Order'),
				// ASSUMPTION: Sales Order has a "project" field. Restricts the
				// dropdown to Sales Orders under the selected AO, once one is chosen.
				get_query: () => {
					const ao = this.ao_field.get_value();
					return ao ? { filters: { project: ao } } : {};
				},
				change: () => { if (this._suppress_change) return; me.on_so_change(); }
			},
			render_input: true
		});

		// Delivery Note — custom multi-select (button + dialog). See the
		// header comment for why this replaces Frappe's MultiSelectList.
		this.setup_dn_field();

		[this.company_field, this.ao_field, this.so_field].forEach(f => f.refresh());
	}

	// Builds the Delivery Note trigger button. The actual checklist is
	// built on demand inside open_dn_dialog() so it always reflects the
	// current AO / Company scope at the moment it's opened.
	setup_dn_field() {
		const $dnWrapper = this.page.main.find('.st-field-dn');
		$dnWrapper.addClass('frappe-control').html(`
			<label class="st-dn-label">${__('Delivery Note')} <span class="st-dn-required">*</span></label>
			<button type="button" class="st-dn-trigger" id="st-dn-trigger">
				<span class="st-dn-trigger-text">${__('Select one or more Delivery Notes')}</span>
				${this.icon('filter', 13)}
			</button>
		`);
		this.render_dn_trigger_label();
	}

	// Updates the trigger button's label to reflect state.selected_dns.
	render_dn_trigger_label() {
		const n = (this.state.selected_dns || []).length;
		this.page.main.find('.st-dn-trigger-text').text(
			n ? __('{0} Delivery Note(s) selected', [n]) : __('Select one or more Delivery Notes')
		);
		this.page.main.find('#st-dn-trigger').toggleClass('has-value', !!n);
	}

	// Opens the searchable checkmark-row dialog for picking Delivery Notes.
	// Options come from the same server-side dn_multiselect_query the old
	// MultiSelectList used, scoped to the current AO Number (or Company as
	// a fallback narrowing filter when no AO is selected). Rows show a bold
	// title + a light description line, and a checkmark + soft highlight
	// when selected — clicking anywhere on the row toggles it (no checkbox
	// input needed).
	open_dn_dialog() {
		const me = this;
		const ao = this.ao_field.get_value();
		const company = this.company_field.get_value();
		const selected = new Set(this.state.selected_dns || []);

		const d = new frappe.ui.Dialog({
			title: __('Select Delivery Notes'),
			fields: [
				{ fieldtype: 'Data', fieldname: 'search', label: __('Search'), placeholder: __('Type to filter...') },
				{ fieldtype: 'HTML', fieldname: 'list_html' }
			],
			primary_action_label: __('Apply'),
			primary_action: () => {
				me.state.selected_dns = Array.from(selected);
				me.render_dn_trigger_label();
				d.hide();
				me.fetch_and_render();
			},
			secondary_action_label: __('Clear All'),
			secondary_action: () => {
				selected.clear();
				d.$wrapper.find('.st-dn-row').removeClass('is-selected');
				d.$wrapper.find('.st-dn-check-icon').remove();
			}
		});

		const render_row = (o) => {
			// dn_multiselect_query returns {value, description}; still handle
			// plain strings / [value, label] pairs for backward compatibility.
			const value = Array.isArray(o) ? o[0] : (o.value !== undefined ? o.value : o);
			const label = Array.isArray(o) ? (o[1] || o[0]) : (o.label || value);
			const desc = (!Array.isArray(o) && o.description) ? o.description : '';
			const isChecked = selected.has(value);
			return `<div class="st-dn-row ${isChecked ? 'is-selected' : ''}" data-value="${frappe.utils.escape_html(value)}">
				<div class="st-dn-row-main">
					<div class="st-dn-row-title">${frappe.utils.escape_html(label)}</div>
					${desc ? `<div class="st-dn-row-desc">${frappe.utils.escape_html(desc)}</div>` : ''}
				</div>
				${isChecked ? `<span class="st-dn-check-icon">${this.icon('check', 15)}</span>` : ''}
			</div>`;
		};

		const render_options = (opts) => {
			const rows = opts.map(render_row).join('');
			d.fields_dict.list_html.$wrapper.html(
				`<div class="st-dn-option-list">${rows || `<p class="st-muted">${__('No matches.')}</p>`}</div>`
			);
		};

		const load_options = (txt) => {
			frappe.call({
				method: 'jasma.jasma.page.stock_traceability.stock_traceability.dn_multiselect_query',
				args: {
					txt: txt || '',
					project: ao || undefined,
					company: (!ao && company) ? company : undefined
				},
				callback: (r) => render_options(r.message || [])
			});
		};

		// Delegate since list_html is re-rendered on every search keystroke.
		// Clicking anywhere on a row toggles its selection (checkmark +
		// highlight), matching the reference picker style.
		d.fields_dict.list_html.$wrapper.on('click', '.st-dn-row', function () {
			const $row = $(this);
			const v = $row.data('value');
			if (selected.has(v)) {
				selected.delete(v);
				$row.removeClass('is-selected').find('.st-dn-check-icon').remove();
			} else {
				selected.add(v);
				$row.addClass('is-selected').append(`<span class="st-dn-check-icon">${me.icon('check', 15)}</span>`);
			}
		});

		d.fields_dict.search.$input.on('input', frappe.utils.debounce((e) => load_options(e.target.value), 250));

		d.show();
		load_options('');
	}

	// Places an icon vertically centered against the control's actual input
	// box (not the field's outer label+input block), so it stays aligned
	// regardless of label length or control height.
	attach_field_icon(field, icon_name) {
		const $wrapper = field.$wrapper.find('.control-input-wrapper').first();
		if (!$wrapper.length) return;
		$wrapper.addClass('st-has-icon').prepend(this.icon(icon_name));
	}

	// Sets a control's value WITHOUT letting it re-trigger the AO/SO
	// cascade. Used whenever the AO -> Sales Order chain (or Reset) sets a
	// field programmatically (AO Number / Sales Order only — Delivery Note
	// is plain state now via state.selected_dns, not a Frappe control, so
	// it no longer needs this).
	//
	// IMPORTANT: this used to null out `field.df.change` and restore it
	// synchronously right after calling `field.set_value()`. That does NOT
	// work — Frappe's Control.set_value() runs an internal async promise
	// chain and only calls `df.change` as its LAST step, well after this
	// function had already returned and restored the original handler. So
	// the "quiet" set was firing its change handler anyway, a moment later,
	// which is what caused AO Number selection to auto-refresh / loop
	// forever (on_ao_change -> quiet-sets Sales Order -> which *actually*
	// fires on_so_change -> which quiet-sets AO Number back -> which
	// *actually* fires on_ao_change again -> ...).
	//
	// Fixed with a re-entrancy counter instead: every cascade-triggered
	// change handler above checks `this._suppress_change` first and bails
	// out for as long as ANY quiet update is still in flight, regardless of
	// exactly when Frappe gets around to invoking df.change.
	set_value_quiet(field, value) {
		this._suppress_change = (this._suppress_change || 0) + 1;
		const release = () => {
			this._suppress_change = Math.max(0, this._suppress_change - 1);
		};

		const safe_value = (value === undefined || value === null) ? '' : value;

		let result;
		try {
			result = field.set_value(safe_value);
		} catch (e) {
			release();
			throw e;
		}

		if (result && typeof result.then === 'function') {
			// Release only once Frappe's internal set-value chain (and its
			// eventual df.change call) has actually finished.
			result.then(release, release);
		} else {
			// Non-promise / synchronous-but-deferred controls: release on
			// the next tick so any microtask-queued change firing is still
			// covered by the guard.
			setTimeout(release, 0);
		}
		return result;
	}

	on_ao_change() {
		const ao = this.ao_field.get_value();
		this.page.main.find('.st-ao-hint').toggle(!!ao);
		this.state.scoped_delivery_notes = [];

		if (!ao) {
			this.set_value_quiet(this.so_field, '');
			this.state.selected_dns = [];
			this.render_dn_trigger_label();
			this.fetch_and_render();
			return;
		}

		frappe.call({
			method: 'jasma.jasma.page.stock_traceability.stock_traceability.get_links_from_ao',
			args: { project: ao },
			callback: (r) => {
				const msg = r.message || {};
				const sales_orders = msg.sales_orders || [];
				const delivery_notes = msg.delivery_notes || [];

				// Auto-fill Sales Order only when it's unambiguous — a single
				// match. Quiet set so it does NOT re-trigger on_so_change.
				this.set_value_quiet(this.so_field, sales_orders.length === 1 ? sales_orders[0] : '');

				// Delivery Note: auto-select EVERY Delivery Note resolved for
				// this AO (not just when there's a single match) —
				// fetch_and_render() below then traces exactly what's shown
				// as selected. Plain state assignment — no quiet-set dance
				// needed since this is no longer a Frappe control.
				this.state.scoped_delivery_notes = delivery_notes;
				this.state.selected_dns = delivery_notes.slice();
				this.render_dn_trigger_label();

				if (!delivery_notes.length) {
					frappe.show_alert({
						message: __('No submitted Delivery Notes found for this AO Number.'),
						indicator: 'orange'
					}, 5);
				}

				this.fetch_and_render();
			}
		});
	}

	on_so_change() {
		// Manual Sales Order selection (independent of the AO cascade, which
		// always uses set_value_quiet and therefore never reaches this method).
		// Bidirectional auto-set: picking a Sales Order resolves its AO
		// Number (Project) too, using a quiet set so it can't loop back into
		// on_ao_change() and start a second, overlapping fetch.
		const so = this.so_field.get_value();
		this.state.scoped_delivery_notes = [];

		if (!so) {
			this.fetch_and_render();
			return;
		}

		frappe.call({
			method: 'jasma.jasma.page.stock_traceability.stock_traceability.get_so_links',
			args: { sales_order: so },
			callback: (r) => {
				const msg = r.message || {};
				this.set_value_quiet(this.ao_field, msg.project || '');

				// Auto-select EVERY Delivery Note linked to this Sales Order,
				// same as the AO cascade above.
				const dns = msg.delivery_notes || [];
				this.state.scoped_delivery_notes = dns;
				this.state.selected_dns = dns.slice();
				this.render_dn_trigger_label();
				this.fetch_and_render();
			}
		});
	}

	/* ---------------------------------------------------------------- */
	/* reset                                                              */
	/* ---------------------------------------------------------------- */

	// Restores the page to its original "nothing selected" state: Company
	// goes back to its default, AO Number / Sales Order / Delivery Note are
	// all cleared, and the "please select a filter" prompt is shown again —
	// exactly what the page looks like on first load.
	reset_filters() {
		this.set_value_quiet(this.ao_field, '');
		this.set_value_quiet(this.so_field, '');
		if (this.company_field.get_value() !== this.default_company) {
			this.set_value_quiet(this.company_field, this.default_company);
		}

		this.state.scoped_delivery_notes = [];
		this.state.selected_dns = [];
		this.render_dn_trigger_label();

		this.page.main.find('.st-ao-hint').hide();
		this.page.main.find('.st-limited-hint').hide();

		this.state.items = [];
		this.state.delivery_notes = [];
		this.state.activeIdx = 0;
		this.state.legendFilter = null;
		this.apply_legend_filter();
		this.render_selection_required();

		frappe.show_alert({ message: __('Filters reset.'), indicator: 'blue' }, 3);
	}

	/* ---------------------------------------------------------------- */
	/* fetch                                                              */
	/* ---------------------------------------------------------------- */

	fetch_and_render() {
		// Guard: never let a second fetch start while one is already running —
		// this is what used to stack up frappe.dom.freeze() calls and hang
		// the page. See header comment.
		if (this._fetching) return;

		// Delivery Note selections live in plain state now (see header
		// comment on the MultiSelectList rewrite).
		const dn = this.state.selected_dns || [];
		const ao = this.ao_field.get_value();
		const so = this.so_field.get_value();

		// REQUIRED: at least one of AO Number / Sales Order / Delivery Note
		// must be selected. Company alone is not enough — it's only a
		// secondary narrowing filter. No filter at all -> show the prompt
		// instead of silently pulling in unrelated recent Delivery Notes.
		if (!dn.length && !ao && !so) {
			this.state.items = [];
			this.state.delivery_notes = [];
			this.state.activeIdx = 0;
			this.page.main.find('.st-limited-hint').hide();
			this.render_selection_required();
			return;
		}

		const args = {};
		if (dn.length) {
			// One or more Delivery Notes are explicitly selected (whether the
			// user picked them manually, or they were auto-selected by the
			// AO/Sales Order cascade) — trace exactly those.
			if (dn.length === 1) {
				args.delivery_note = dn[0];
			} else {
				args.delivery_notes = JSON.stringify(dn);
			}
		} else if ((ao || so) && this.state.scoped_delivery_notes.length) {
			// AO / Sales Order scope is active and resolved to one or more
			// Delivery Notes, but the selection was cleared out by the
			// user — fall back to tracing every Delivery Note in scope.
			args.delivery_notes = JSON.stringify(this.state.scoped_delivery_notes);
		} else {
			// AO / Sales Order scope is active but resolved to zero Delivery
			// Notes — nothing to trace, and we deliberately do NOT fall back
			// to the unrelated "recent Delivery Notes" list here.
			this.state.items = [];
			this.state.delivery_notes = [];
			this.state.activeIdx = 0;
			this.render_summary_and_list();
			this.render_diagram();
			this.render_report();
			return;
		}

		// Company remains available as a secondary narrowing filter, but it
		// can no longer trigger a fetch on its own since AO/SO/DN is required.
		const company = this.company_field.get_value();
		if (company) args.company = company;

		this._fetching = true;
		this.set_refresh_loading(true);
		this.set_results_loading(true);

		frappe.call({
			method: 'jasma.jasma.page.stock_traceability.stock_traceability.get_dn_traceability',
			args: args,
			callback: (r) => {
				if (!r.message) return;
				this.state.items = r.message.items || [];
				this.state.delivery_notes = r.message.delivery_notes || [];
				this.state.activeIdx = 0;
				this.state.legendFilter = null;

				this.page.main.find('.st-limited-hint').toggle(!!r.message.limited);
				if (r.message.limited) {
					this.page.main.find('.st-limited-hint').text(
						__('Showing the {0} most recent Delivery Notes for this selection. Pick specific Delivery Notes, or narrow the AO Number / Sales Order / Company above.', [r.message.limit])
					);
				}

				this.render_summary_and_list();
				this.render_diagram();
				this.render_report();

				const non_fifo = this.state.items.filter(i => i.isFifo === false);
				if (non_fifo.length) {
					frappe.show_alert({
						message: __('{0} item(s) use Moving Average valuation and were not traced (FIFO only).',
							[non_fifo.length]),
						indicator: 'orange'
					}, 7);
				}
			},
			always: () => {
				// Unconditional cleanup (success, error, or thrown exception) —
				// the loading overlay and button state can never get stuck open.
				this.set_results_loading(false);
				this.set_refresh_loading(false);
				this._fetching = false;
			}
		});
	}

	// Scoped loading indicator — dims/blurs ONLY the results panel (tabs +
	// tables + diagram), not the whole Desk (sidebar, navbar, etc). Replaces
	// the old frappe.dom.freeze()/unfreeze() full-page overlay, which used to
	// visibly "blink" the entire screen on every AO/SO/DN change.
	set_results_loading(is_loading) {
		this.page.main.find('.st-loading-overlay').toggleClass('is-active', !!is_loading);
	}

	set_refresh_loading(is_loading) {
		const $btn = this.page.main.find('#st-refresh');
		$btn.toggleClass('is-loading', !!is_loading);
		$btn.prop('disabled', !!is_loading);
	}

	// Shown on load, and whenever AO Number / Sales Order / Delivery Note are
	// all empty — selecting at least one of these three is now mandatory.
	render_selection_required() {
		const msg = __('Select an AO Number, Sales Order, or Delivery Note to view traceability.');
		this.page.main.find('.st-summary-body').html(
			`<tr><td colspan="9"><div class="st-select-prompt">${this.icon('info', 15)} ${msg}</div></td></tr>`
		);
		this.page.main.find('.st-item-list').html(
			`<div class="st-empty-state st-empty-state--prompt">${this.icon('filter', 26)}<p>${msg}</p></div>`
		);
		this.page.main.find('.st-flow-canvas').html(
			`<div class="st-empty-state st-empty-state--prompt">${this.icon('filter', 26)}<p>${msg}</p></div>`
		);
		this.page.main.find('.st-diag-dn, .st-diag-item, .st-diag-delivered, .st-diag-traced').text('-');
		this.page.main.find('.st-report-body').html(
			`<tr><td colspan="7"><div class="st-select-prompt">${this.icon('info', 15)} ${msg}</div></td></tr>`
		);
	}

	/* ---------------------------------------------------------------- */
	/* shell / static markup                                             */
	/* ---------------------------------------------------------------- */

	render_shell() {
		this.page.main.html(`
		<div class="st-page">
		<div class="st-shell">

			<div class="st-filter-bar">
				<div class="st-filter-row">
					<div class="st-field st-field-icon st-field-company"></div>

					<div class="st-filter-divider"></div>

					<div class="st-field st-field-ao"></div>
					<div class="st-field st-field-so"></div>
					<div class="st-field st-field-dn"></div>

					<div class="st-filter-right">
						<div class="st-filter-right-spacer">&nbsp;</div>
						<div class="st-filter-right-buttons">
							<button class="st-icon-btn st-icon-btn-ghost" id="st-reset" title="${__('Reset Filters')}">
								${this.icon('xcircle')}
								<span class="st-refresh-label">${__('Reset')}</span>
							</button>
							<button class="st-icon-btn" id="st-refresh" title="${__('Refresh / Get Sources')}">
								${this.icon('refresh')}
								<span class="st-refresh-label">${__('Refresh')}</span>
							</button>
							<button class="st-icon-btn" id="st-theme-toggle" title="${__('Switch to Dark Mode')}">${this.icon('moon')}</button>
						</div>
					</div>
				</div>
			</div>

			<div class="st-hint st-required-hint">
				${this.icon('info', 13)} ${__('Select at least one — AO Number, Sales Order, or Delivery Note — to load traceability data.')}
			</div>
			<div class="st-hint st-ao-hint" style="display:none;">
				${this.icon('info', 13)} ${__('AO Number narrows the Sales Order and Delivery Note fields to that AO, and traces every Delivery Note under it.')}
			</div>
			<div class="st-hint st-limited-hint" style="display:none;"></div>

			<div class="st-tabs">
				<div class="st-tab active" data-tab="flow">${this.icon('git', 14)} ${__('Traceability Flow')}</div>
				<div class="st-tab" data-tab="report">${this.icon('bar', 14)} ${__('Report View')}</div>
			</div>

			<div class="st-panels-wrap">
				<div class="st-loading-overlay">
					<div class="st-spinner"></div>
					<span>${__('Tracing stock sources...')}</span>
				</div>

			<div class="st-tab-panel active" data-panel="flow">
				<div class="st-card st-anim" style="--delay:1;">
					<div class="st-section-title">${this.icon('layers', 14)} ${__('Items Summary')}</div>
					<div class="st-table-scroll">
					<table class="st-table">
						<thead>
							<tr>
								<th>#</th><th>${__('AO Number')}</th><th>${__('Delivery Note')}</th><th>${__('Item Code')}</th><th>${__('Item Name')}</th>
								<th>${__('Item Group')}</th><th>${__('UOM')}</th>
								<th>${__('Delivered Qty')}</th><th>${__('Traced Qty')}</th>
							</tr>
						</thead>
						<tbody class="st-summary-body">
							<tr><td colspan="9" class="st-muted">${__('Loading...')}</td></tr>
						</tbody>
					</table>
					</div>
				</div>

				<div class="st-flow-layout">
					<div class="st-anim" style="--delay:2;">
						<div class="st-item-list-head">
							<h3>${__('Traceability Flow (Item Wise)')}</h3>
							<p>${__('Select an item to view its full source document flow')}</p>
						</div>
						<div class="st-item-list"></div>
					</div>

					<div class="st-diagram-card st-anim" style="--delay:3;">
						<div class="st-diagram-toolbar">
							<div class="st-diagram-info">
								<span><span class="st-info-label">${__('DN')}</span><b class="st-diag-dn">-</b></span>
								<span><span class="st-info-label">${__('Item')}</span><b class="st-diag-item">-</b></span>
								<span><span class="st-info-label">${__('Delivered')}</span><b class="st-diag-delivered">-</b></span>
								<span><span class="st-info-label">${__('Traced')}</span><b class="st-diag-traced">-</b></span>
							</div>
						</div>
						<div class="st-flow-canvas"></div>
						<div class="st-legend-wrap">
							<div class="st-legend">
								<button type="button" class="st-legend-item st-legend-all is-active" data-type="all" title="${__('Clear highlight — show every document type')}">
									${this.icon('link', 12)}${__('All')}
								</button>
								<button type="button" class="st-legend-item" data-type="dn" title="${__('Click to highlight Delivery Documents')}">
									<i class="st-dot" style="background:var(--st-fp-blue-bg); border:1px solid var(--st-fp-blue-border);"></i>${__('Delivery Document')}
								</button>
								<button type="button" class="st-legend-item" data-type="doc" title="${__('Click to highlight Stock Movement / Receipt documents')}">
									<i class="st-dot" style="background:var(--st-fp-green-bg); border:1px solid var(--st-fp-green-border);"></i>${__('Stock Movement / Receipt')}
								</button>
								<button type="button" class="st-legend-item" data-type="order" title="${__('Click to highlight Order Documents')}">
									<i class="st-dot" style="background:var(--st-fp-purple-bg); border:1px solid var(--st-fp-purple-border);"></i>${__('Order Document')}
								</button>
								<button type="button" class="st-legend-item" data-type="request" title="${__('Click to highlight Request Documents')}">
									<i class="st-dot" style="background:var(--st-fp-orange-bg); border:1px solid var(--st-fp-orange-border);"></i>${__('Request Document')}
								</button>
								<button type="button" class="st-legend-item" data-type="warehouse" title="${__('Click to highlight Warehouses')}">
									<i class="st-dot" style="background:var(--st-fp-cyan-bg); border:1px solid var(--st-fp-cyan-border);"></i>${__('Warehouse')}
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div class="st-tab-panel" data-panel="report">
				<div class="st-card st-anim" style="--delay:1;">
					<div class="st-report-toolbar">
						<div>
							<div class="st-section-title" style="margin-bottom:2px;">${this.icon('file', 14)} ${__('Consumption Report')}</div>
							<p class="st-report-sub">${__('Each delivered item, the component actually consumed, quantity, and its source PO.')}</p>
						</div>
					</div>
					<div class="st-table-scroll">
					<table class="st-table st-report-table">
						<thead>
							<tr>
								<th style="width:14%;">${__('Delivery Note')}</th>
								<th style="width:18%;">${__('Delivered Item')}</th>
								<th style="width:9%;">${__('Delivered Qty')}</th>
								<th style="width:21%;">${__('Component / Raw Material')}</th>
								<th style="width:8%;">${__('Qty')}</th>
								<th style="width:15%;">${__('Source Document')}</th>
								<th style="width:15%;">${__('Purchase / Sub. Order')}</th>
							</tr>
						</thead>
						<tbody class="st-report-body"></tbody>
					</table>
					</div>
				</div>
			</div>

			</div>
		</div>
		</div>
		`);
	}

	bind_shell_events() {
		this.page.main.on('click', '.st-tab', (e) => {
			const name = $(e.currentTarget).data('tab');
			this.page.main.find('.st-tab').removeClass('active');
			$(e.currentTarget).addClass('active');
			this.page.main.find('.st-tab-panel').removeClass('active');
			this.page.main.find(`.st-tab-panel[data-panel="${name}"]`).addClass('active');
		});

		this.page.main.on('click', '.st-doc-link', (e) => {
			e.preventDefault();
			const $t = $(e.currentTarget);
			const name = $t.data('name');
			// Explicit data-doctype (e.g. Item links from the Items Summary
			// table, or Project links from the AO Number chip, or the
			// title -> doctype map used by diagram nodes via node_doctype(),
			// or the SLE / hint-entry links from the untraced diagnostics)
			// wins; otherwise fall back to the naming-series guess.
			const doctype = $t.data('doctype') || this.guess_doctype(name);
			if (doctype) {
				frappe.set_route('Form', doctype, name);
			} else {
				frappe.msgprint(__('Could not resolve document type for {0}.', [name]));
			}
		});

		this.page.main.on('click', '.st-selectable-row, .st-item-card', (e) => {
			const idx = $(e.currentTarget).data('idx');
			if (idx === undefined) return;
			this.state.activeIdx = idx;
			this.render_summary_and_list();
			this.render_diagram();
		});

		this.page.main.on('click', '#st-refresh', () => this.fetch_and_render());
		this.page.main.on('click', '#st-reset', () => this.reset_filters());
		this.page.main.on('click', '#st-theme-toggle', () => this.toggle_theme());
		this.page.main.on('click', '#st-dn-trigger', () => this.open_dn_dialog());

		// Legend chips are clickable: picking one highlights every node of
		// that type in the diagram and dims the rest. The "All" chip (or
		// clicking the same chip twice) clears the filter and shows
		// everything at full colour again.
		this.page.main.on('click', '.st-legend-item', (e) => {
			const type = $(e.currentTarget).data('type');
			if (type === 'all') {
				this.state.legendFilter = null;
			} else {
				this.state.legendFilter = (this.state.legendFilter === type) ? null : type;
			}
			this.apply_legend_filter();
		});
	}

	// Reflects state.legendFilter onto the legend chips (is-active state)
	// and onto the diagram canvas (data-legend-filter attribute, which the
	// CSS uses to dim non-matching nodes and pop the matching ones). Safe
	// to call any time — e.g. again after render_diagram() re-renders the
	// canvas's inner HTML, since the attribute lives on the canvas element
	// itself and would otherwise need re-applying after every re-render.
	apply_legend_filter() {
		const type = this.state.legendFilter;
		this.page.main.find('.st-legend-item').removeClass('is-active');
		const $canvas = this.page.main.find('.st-flow-canvas');
		if (type) {
			this.page.main.find(`.st-legend-item[data-type="${type}"]`).addClass('is-active');
			$canvas.attr('data-legend-filter', type);
		} else {
			this.page.main.find('.st-legend-item[data-type="all"]').addClass('is-active');
			$canvas.removeAttr('data-legend-filter');
		}
	}

	/* ---------------------------------------------------------------- */
	/* rendering                                                          */
	/* ---------------------------------------------------------------- */

	pct_badge(it) {
		if (it.isFifo === false) {
			return { pct: null, cls: 'skipped', label: __('{0} (not traced)', [it.valuationMethod || __('Non-FIFO')]) };
		}
		const pct = it.delivered ? (it.traced / it.delivered * 100) : 0;
		const cls = pct >= 99.995 ? 'full' : (pct <= 0.005 ? 'zero' : 'partial');
		return { pct: pct.toFixed(2), cls, label: `${it.traced} (${pct.toFixed(2)}%)` };
	}

	render_summary_and_list() {
		const body = this.page.main.find('.st-summary-body');
		const list = this.page.main.find('.st-item-list');
		body.empty();
		list.empty();

		if (!this.state.items.length) {
			body.html(`<tr><td colspan="9" class="st-muted">${__('No delivered items found.')}</td></tr>`);
			list.html(`<div class="st-empty-state">${this.icon('inbox', 22)}<p>${__('No delivered items found for the selected filters.')}</p></div>`);
			return;
		}

		this.state.items.forEach((it, i) => {
			const { cls, label } = this.pct_badge(it);
			body.append(`
				<tr class="st-selectable-row ${i === this.state.activeIdx ? 'is-active' : ''}" data-idx="${i}">
					<td>${i + 1}</td>
					<td>${this.chip_link(it.ao, 'Project', 'ao')}</td>
					<td>${this.chip_link(it.dn, 'Delivery Note', 'dn')}</td>
					<td>${this.doc_link(it.code, 'Item')}</td>
					<td>${frappe.utils.escape_html(it.name || '')}</td>
					<td>${frappe.utils.escape_html(it.group || '')}</td>
					<td>${frappe.utils.escape_html(it.uom || '')}</td>
					<td>${it.delivered}</td>
					<td><span class="st-pct-pill ${cls}">${label}</span></td>
				</tr>`);

			const untraced = flt(it.delivered - it.traced, 2);
			const row2 = it.isFifo === false
				? `<span class="st-muted">${__('Valuation')}: ${frappe.utils.escape_html(it.valuationMethod || '')} — ${__('tracing not applicable')}</span>`
				: `<span>${__('Traced')}: ${it.traced} &nbsp;|&nbsp; ${__('Untraced')}: ${untraced}</span>`;
			list.append(`
				<div class="st-item-card ${i === this.state.activeIdx ? 'is-active' : ''}" data-idx="${i}">
					<div class="st-item-row1"><span class="st-item-code">${frappe.utils.escape_html(it.code)}</span>
						<span class="st-item-delivered">${__('Delivered')}&nbsp;<b>${it.delivered}</b></span></div>
					<div class="st-item-name">${frappe.utils.escape_html(it.name || '')} <span class="st-muted">(${frappe.utils.escape_html(it.dn)})</span></div>
					${it.ao ? `<div class="st-item-ao">${this.chip_link(it.ao, 'Project', 'ao')}</div>` : ''}
					<div class="st-item-row2">${row2}
						<span class="st-badge-pct ${cls}">${cls === 'skipped' ? __('N/A') : label.split(' ').pop()}</span></div>
				</div>`);
		});
	}

	// Maps a diagram node's {t, title} to a real doctype so it can be made
	// clickable (st-doc-link + data-doctype), mirroring chip_link()/doc_link()
	// for the Items Summary and Report tables. Returns null for nodes that
	// don't correspond to an openable document (e.g. "Opening Stock" /
	// "Non-FIFO Item — Skipped" placeholders, or a bare item-code label) —
	// those stay unclickable rather than routing somewhere wrong.
	node_doctype(n) {
		const title = n.title || '';
		if (n.t === 'doc') {
			if (title.indexOf('Stock Entry') === 0) return 'Stock Entry';
			if (title === 'Purchase Receipt') return 'Purchase Receipt';
			if (title === 'Subcontracting Receipt') return 'Subcontracting Receipt';
		}
		if (n.t === 'order') {
			if (title === 'Purchase Order') return 'Purchase Order';
			if (title === 'Subcontracting Order') return 'Subcontracting Order';
		}
		if (n.t === 'request' && title === 'Material Request') return 'Material Request';
		if (n.t === 'warehouse' && title === 'From Warehouse') return 'Warehouse';
		// "Raw Material" / "Raw Material Consumed" warehouse-styled nodes
		// carry an Item code in `sub`, not a warehouse — route to Item.
		if (n.t === 'warehouse' && (title === 'Raw Material' || title === 'Raw Material Consumed')) return 'Item';
		return null;
	}

	// Renders one diagram node. Nodes with a `meta` block (currently only
	// the "Raw Material Consumed" node built in resolve_subcontracting_receipt())
	// get a small panel underneath showing the source SLE, the RM item code,
	// and the RM qty consumed vs. the finished-good qty it covers.
	//
	// Kept deliberately compact per updated requirements:
	//   - "RM Item" shows just the plain Item Code — no item name, not a
	//     link — so the panel reads as a quick label rather than a wall of
	//     text.
	//   - The reference-row ("Ref: ...") line has been removed entirely.
	//   - The node's own headline Qty (n.qty) is guaranteed by the backend
	//     to equal "RM Qty Consumed" below, so the two numbers always agree.
		node_html(n) {
			const doctype = this.node_doctype(n);
			const clickable = !!(doctype && n.sub);
			const innerAttrs = clickable
				? ` href="#" class="st-node-inner st-node-clickable st-doc-link" data-name="${frappe.utils.escape_html(n.sub)}" data-doctype="${frappe.utils.escape_html(doctype)}"`
				: ` class="st-node-inner"`;
			const innerTag = clickable ? 'a' : 'div';

			let metaHTML = '';
			if (n.meta) {
				const m = n.meta;
				const sleLink = m.sle
					? `<a class="st-node-meta-link st-doc-link" href="#" data-name="${frappe.utils.escape_html(m.sle)}" data-doctype="Stock Ledger Entry">${frappe.utils.escape_html(m.sle)}</a>`
					: '';
				metaHTML = `<div class="st-node-meta">
					${m.rm_item_code ? `<div>${__('RM Item')}: <span class="st-node-meta-code">${frappe.utils.escape_html(m.rm_item_code)}</span></div>` : ''}
					${m.rm_qty_consumed !== undefined ? `<div>${__('RM Qty Consumed')}: ${m.rm_qty_consumed}</div>` : ''}
					${m.fg_qty_covered !== undefined ? `<div>${__('Main Item Qty')}: ${m.fg_qty_covered}</div>` : ''}
					${sleLink ? `<div>${__('Source SLE')}: ${sleLink}</div>` : ''}
				</div>`;
			}

			const mainHTML = `<div class="st-node st-node-${n.t}">
				<${innerTag}${innerAttrs}>
					${clickable ? `<span class="st-node-open">${this.icon('link', 10)}</span>` : ''}
					<div class="st-node-t">${frappe.utils.escape_html(n.title)}</div>
					<div class="st-node-s">${frappe.utils.escape_html(n.sub)}</div>
					<div class="st-node-s" style="font-weight:700;">${frappe.utils.escape_html(n.qty)}</div>
				</${innerTag}>
				${metaHTML}
			</div>`;

			if (!n.side) return mainHTML;

			// Side branch: currently only Subcontracting Receipt -> its own
			// Subcontracting Order. Rendered to the RIGHT of the main box —
			// completely separate from the vertical Raw Material -> Purchase
			// Receipt -> Purchase Order chain that continues below the SR node.
			const s = n.side;
			const sideDoctype = this.node_doctype(s);
			const sideClickable = !!(sideDoctype && s.sub);
			const sideInnerAttrs = sideClickable
				? ` href="#" class="st-node-inner st-node-clickable st-doc-link" data-name="${frappe.utils.escape_html(s.sub)}" data-doctype="${frappe.utils.escape_html(sideDoctype)}"`
				: ` class="st-node-inner"`;
			const sideInnerTag = sideClickable ? 'a' : 'div';
			const sideHTML = `<div class="st-node st-node-${s.t} st-node-side">
				<${sideInnerTag}${sideInnerAttrs}>
					${sideClickable ? `<span class="st-node-open">${this.icon('link', 10)}</span>` : ''}
					<div class="st-node-t">${frappe.utils.escape_html(s.title)}</div>
					<div class="st-node-s">${frappe.utils.escape_html(s.sub)}</div>
					<div class="st-node-s" style="font-weight:700;">${frappe.utils.escape_html(s.qty)}</div>
				</${sideInnerTag}>
			</div>`;

			return `<div class="st-node-with-side">
				${mainHTML}
				<div class="st-node-side-connector"></div>
				${sideHTML}
			</div>`;
	}

	render_diagram() {
		const canvas = this.page.main.find('.st-flow-canvas');
		const it = this.state.items[this.state.activeIdx];
		if (!it) {
			canvas.html(`<div class="st-empty-state">${this.icon('inbox', 22)}<p>${__('No item selected.')}</p></div>`);
			this.page.main.find('.st-diag-dn, .st-diag-item, .st-diag-delivered, .st-diag-traced').text('-');
			return;
		}

		const { cls, label } = this.pct_badge(it);
		// DN + Item are now real document links (same st-doc-link mechanism
		// as everywhere else), and Traced is a colored pill — green when
		// fully traced, amber when partial, red when 0%/untraced — so the
		// header reads at a glance instead of being flat black text.
		this.page.main.find('.st-diag-dn').html(this.chip_link(it.dn, 'Delivery Note', 'dn'));
		const itemNameSafe = frappe.utils.escape_html(it.name || '');
		this.page.main.find('.st-diag-item').html(
			`<span class="st-diag-item-line" title="${itemNameSafe}">${this.doc_link(it.code, 'Item')}<span class="st-diag-item-name">${it.name ? ' — ' + itemNameSafe : ''}</span></span>`
		);
		this.page.main.find('.st-diag-delivered').text(it.delivered);
		this.page.main.find('.st-diag-traced').html(`<span class="st-pct-pill st-pct-pill-lg ${cls}">${label}</span>`);

		// Each entry in it.branches is a SELF-CONTAINED chain from the server
		// (by design — see Section 5 of the logic doc), so two branches that
		// share the same first few documents (e.g. the same Stock Entry +
		// From Warehouse before splitting at a later Subcontracting Receipt)
		// arrive as two separate chains with identical leading nodes. Drawing
		// them as independent columns duplicates those shared steps. Merge
		// them into one tree here — shared steps (same title + same document
		// name at the same depth) are drawn once, and columns only fan out
		// at the point where the underlying documents actually differ.
		const tracedBranches = (it.branches || []).filter(b => !b.untraced);
		const untracedBranches = (it.branches || []).filter(b => b.untraced);
		const tree = this.build_chain_tree(tracedBranches);
		const topNodes = tree.concat(untracedBranches.map(b => ({ untraced: b })));

		const branchesHTML = topNodes.length
			? this.render_branch_row(topNodes)
			: `<div class="st-empty-state st-empty-state--untraced">${this.icon('inbox', 22)}<p>${__('No source documents found — this quantity could not be traced (e.g. opening stock, a stock reconciliation, or negative stock).')}</p></div>`;

		// A visible vertical stem always connects the root Delivery Note
		// node down into the branch row below it (see .st-root-stem CSS) —
		// previously there was no line here at all.
				canvas.html(`
			<div class="st-tree-wrap">
				<a href="#" class="st-root-node st-doc-link" data-name="${frappe.utils.escape_html(it.dn || '')}" data-doctype="Delivery Note">
					<span class="st-node-open st-node-open-root">${this.icon('link', 10)}</span>
					<div class="st-node-t">${__('Delivery Note')}</div>
					<div class="st-node-s">${frappe.utils.escape_html(it.dn || '')}</div>
					<div class="st-node-s">${__('Item')}: ${frappe.utils.escape_html(it.code)} | ${__('Qty')}: ${it.delivered}</div>
				</a>
				${topNodes.length ? '<div class="st-root-stem"></div>' : ''}
				${branchesHTML}
			</div>
		`);

		this.apply_legend_filter();
		// Layout must be committed before we can measure real positions.
		requestAnimationFrame(() => this.align_tree_centers());
	}

	// Every parent that sits ABOVE a fork (the root Delivery Note node,
	// or a .st-branch-chain sitting above a nested fork) is centered by
	// CSS relative to ITS OWN column width — which only matches the
	// fork's true visual center (midpoint between its first and last
	// sibling) when both siblings are equally wide. When a fork has one
	// short branch and one wide/further-forked branch (the common case),
	// those two points diverge and the parent renders visibly off-center.
	// This measures the ACTUAL rendered positions and nudges each such
	// parent (via transform) onto the fork's real midpoint.
	align_tree_centers() {
		const canvasEl = this.page.main.find('.st-flow-canvas').get(0);
		if (!canvasEl) return;

		// Root Delivery Note node + its stem, over the top-level fork.
		const topRow = canvasEl.querySelector('.st-tree-wrap > .st-branch-row');
		this._align_over_row(
			canvasEl.querySelector('.st-root-node'),
			canvasEl.querySelector('.st-root-stem'),
			topRow,
			canvasEl.querySelector('.st-tree-wrap')
		);

		// Every branch whose chain sits directly above its own nested fork.
		canvasEl.querySelectorAll('.st-branch').forEach(branchEl => {
			const nestedRow = branchEl.querySelector(':scope > .st-branch-row');
			if (!nestedRow) return;
			this._align_over_row(
				branchEl.querySelector(':scope > .st-branch-chain'),
				branchEl.querySelector(':scope > .st-connector-into-fork'),
				nestedRow,
				branchEl
			);
		});
	}

	// Shifts topEl + stemEl (via transform) so they sit exactly above the
	// midpoint between rowEl's first and last direct .st-branch child —
	// the fork's true visual center — instead of containerEl's own center.
	_align_over_row(topEl, stemEl, rowEl, containerEl) {
		if (!rowEl || !containerEl) return;
		const siblings = Array.from(rowEl.children).filter(c => c.classList.contains('st-branch'));
		if (siblings.length < 2) {
			// Not a fork (single branch) — natural centering is already correct.
			if (topEl) topEl.style.transform = '';
			if (stemEl) stemEl.style.transform = '';
			return;
		}
		const first = siblings[0].getBoundingClientRect();
		const last = siblings[siblings.length - 1].getBoundingClientRect();
		const trueCenter = ((first.left + first.width / 2) + (last.left + last.width / 2)) / 2;
		const containerCenter = containerEl.getBoundingClientRect().left + containerEl.getBoundingClientRect().width / 2;
		const delta = trueCenter - containerCenter;

		if (topEl) topEl.style.transform = delta ? `translateX(${delta}px)` : '';
		if (stemEl) stemEl.style.transform = delta ? `translateX(${delta}px)` : '';
	}

	// Builds a merge tree from a flat list of {qty, chain:[node,...]} branches.
	// Two branches share a tree node whenever they have the same node.title
	// AND node.sub (the actual document name) at the same depth — i.e. it's
	// genuinely the same document, not just a similarly-labelled one.
	build_chain_tree(branches) {
		const roots = [];
		const find_or_create = (list, node) => {
			let existing = list.find(c => !c.untraced && c.node.title === node.title && c.node.sub === node.sub);
			if (!existing) {
				existing = { node, children: [] };
				list.push(existing);
			}
			return existing;
		};
		branches.forEach(b => {
			let list = roots;
			(b.chain || []).forEach(n => {
				const tn = find_or_create(list, n);
				list = tn.children;
			});
		});
		return roots;
	}

	// Renders a row of sibling subtrees (a branch point, or the single
	// unbranched trunk when there's only one). The CSS on .st-branch-row /
	// .st-branch draws the actual connector lines (horizontal bar + vertical
	// stems) — see the "visible tree connector lines" header note.
	render_branch_row(nodes) {
		if (!nodes || !nodes.length) return '';
		const single = nodes.length === 1 ? ' is-single' : '';
		return `<div class="st-branch-row${single}">${nodes.map(tn => this.render_subtree(tn)).join('')}</div>`;
	}

	// Renders one column: walks straight down through however many
	// unbranched (single-child) steps come next, drawing one node per step,
	// then — only if the chain genuinely forks — opens a nested branch row.
	//
	// Untraced branches render the DIAGNOSED reason from the backend
	// (_diagnose_shortfall() in the .py) instead of a flat "Opening Stock"
	// label: the resolved item name, and — when the backend found a nearby
	// entry that just couldn't be used (wrong date / wrong warehouse) — a
	// clickable link straight to that entry and its Stock Ledger Entry.
	render_subtree(tn) {
		if (tn.untraced) {
			const b = tn.untraced;

			// Short form: Stock Reconciliation / genuine Opening Stock —
			// just the label + item code, no paragraph, no nearest-entry
			// or SLE links.
						// Short form: Stock Reconciliation / genuine Opening Stock —
			// label + entry number (clickable, when one exists) + item
			// code, no paragraph, no extra meta panel.
			if (b.short && !b.skipped_valuation) {
				const title = b.hint_entry ? __('Stock Reconciliation Entry') : __('Opening Stock');
				const entryLine = b.hint_entry
					? `<div class="st-node-s"><a class="st-node-meta-link st-doc-link" href="#" data-name="${frappe.utils.escape_html(b.hint_entry)}" data-doctype="${frappe.utils.escape_html(b.hint_entry_type || 'Stock Reconciliation')}">${frappe.utils.escape_html(b.hint_entry)}</a></div>`
					: '';
				return `
					<div class="st-branch">
						<div class="st-qty-label">${__('Qty')}: ${b.qty}</div>
						<div class="st-node st-node-request" style="border-style:dashed; opacity:.85;">
							<div class="st-node-inner">
								<div class="st-node-t">${title}</div>
								${entryLine}
								<div class="st-node-s">${__('Item')}: ${frappe.utils.escape_html(b.item_name || '')}</div>
							</div>
						</div>
					</div>`;
			}

			const hasHint = !b.skipped_valuation && b.hint_entry;
			const title = b.skipped_valuation
				? __('Non-FIFO Item — Skipped')
				: (hasHint ? __('Nearby Entry Found — Not Usable') : __('Opening Stock'));

			const lines = [];
			if (!b.skipped_valuation && b.item_name) {
				lines.push(`<div>${__('Item')}: ${frappe.utils.escape_html(b.item_name)}</div>`);
			}
			if (hasHint) {
				lines.push(`<div>${__('Nearest Entry')}: <a class="st-node-meta-link st-doc-link" href="#" data-name="${frappe.utils.escape_html(b.hint_entry)}" data-doctype="${frappe.utils.escape_html(b.hint_entry_type || '')}">${frappe.utils.escape_html(b.hint_entry)}</a></div>`);
				if (b.hint_sle) {
					lines.push(`<div>${__('SLE')}: <a class="st-node-meta-link st-doc-link" href="#" data-name="${frappe.utils.escape_html(b.hint_sle)}" data-doctype="Stock Ledger Entry">${frappe.utils.escape_html(b.hint_sle)}</a></div>`);
				}
			}
			const hintHTML = lines.length ? `<div class="st-node-meta">${lines.join('')}</div>` : '';

			return `
				<div class="st-branch">
					<div class="st-qty-label">${__('Qty')}: ${b.qty} (${__('untraced')})</div>
					<div class="st-node st-node-request" style="border-style:dashed; opacity:.85;">
						<div class="st-node-inner">
							<div class="st-node-t">${title}</div>
							<div class="st-node-s">${frappe.utils.escape_html(b.note || __('Untraced quantity'))}</div>
						</div>
						${hintHTML}
					</div>
				</div>`;
		}

				let chainHTML = '';
		let cursor = tn;
		let first = true;
		while (cursor) {
			if (!first) chainHTML += `<div class="st-connector"></div>`;
			// Every node in the chain now gets its own "Qty: X" pill
			// directly above its box — not just the first node in the
			// branch. cursor.node.qty is already the pre-formatted
			// "Qty: N" string from _node() in the .py, same source the
			// old branch-level label used.
			chainHTML += `<div class="st-qty-label">${frappe.utils.escape_html(cursor.node.qty)}</div>`;
			chainHTML += this.node_html(cursor.node);
			first = false;
			if (cursor.children.length === 1) {
				cursor = cursor.children[0];
			} else {
				break;
			}
		}

				let nestedHTML = '';
		if (cursor && cursor.children.length > 1) {
			// Tagged separately from a plain .st-connector so
			// align_tree_centers() can find and nudge exactly the
			// connector that leads INTO a fork (not every connector).
			nestedHTML = `<div class="st-connector st-connector-into-fork"></div>${this.render_branch_row(cursor.children)}`;
		}

		// Everything ABOVE a fork (qty label + stacked chain nodes) is
		// wrapped in .st-branch-chain so it can be shifted as one rigid
		// unit — see align_tree_centers(): when the fork below has
		// unevenly-sized siblings, the fork's true visual center isn't
		// the same as this column's own center, so the chain above it
		// (and its connector) get nudged sideways after render to land
		// exactly over the fork's real midpoint.
		return `
			<div class="st-branch">
				<div class="st-branch-chain">
					${chainHTML}
				</div>
				${nestedHTML}
			</div>`;
	}

	render_report() {
		const body = this.page.main.find('.st-report-body');
		let rows = '';

		this.state.items.forEach(it => {
			const branches = it.branches || [];
			const leadItemCell = `${this.doc_link(it.code, 'Item')}<br><span class="st-muted">${frappe.utils.escape_html(it.name || '')}</span>`;

			if (!branches.length) {
				rows += `<tr>
					<td class="st-dn-cell">${this.chip_link(it.dn, 'Delivery Note', 'dn')}</td>
					<td class="st-item-cell">${leadItemCell}</td>
					<td>${it.delivered}</td>
					<td class="st-muted" colspan="4">${__('No source data.')}</td>
				</tr>`;
				return;
			}

			// One row per branch (= per source document) exactly as before —
			// so an item genuinely fed by 3, 4, or more separate source
			// documents still gets that many rows. The DN / Item / Delivered
			// Qty cells now span ALL of that item's rows via rowspan instead
			// of being blanked out on continuation rows, so it's immediately
			// visible that every row underneath belongs to the same item.
			const rowspan = branches.length;

			branches.forEach((b, i) => {
				const leadCells = i === 0
					? `<td class="st-dn-cell" rowspan="${rowspan}" style="vertical-align:middle;">${this.chip_link(it.dn, 'Delivery Note', 'dn')}</td>
					   <td class="st-item-cell" rowspan="${rowspan}" style="vertical-align:middle;">${leadItemCell}</td>
					   <td rowspan="${rowspan}" style="vertical-align:middle;"><b>${it.delivered}</b></td>`
					: '';

				if (b.untraced) {
					// Same diagnostic hint as the diagram (see render_subtree()):
					// prefer a clickable link to the nearby-but-unusable entry
					// over a flat "not traced" label whenever the backend found one.
					let reason;
					if (b.skipped_valuation) {
						reason = __('— {0}, not FIFO —', [it.valuationMethod || __('Non-FIFO')]);
					} else if (b.short) {
						reason = b.hint_entry
							? `${__('Stock Reconciliation')}: ${this.chip_link(b.hint_entry, b.hint_entry_type || 'Stock Reconciliation', 'src')}`
							: __('Opening Stock');
					} else if (b.hint_entry) {
						reason = `${__('— nearest entry')}: ${this.chip_link(b.hint_entry, b.hint_entry_type, 'src')}`;
					} else {
						reason = __('— not traced (opening stock) —');
					}
					rows += `<tr>
						${leadCells}
						<td class="st-muted">${reason}</td>
						<td>${b.qty}</td>
						<td class="st-muted">—</td>
						<td class="st-muted">—</td>
					</tr>`;
					return;
				}

				// Component / Raw Material cell — always shows the component's
				// OWN Item Code (clickable) + resolved Item Name. For a Direct
				// item (delivered stock item consumed as-is, no RM breakdown)
				// this mirrors the delivered item's own code/name rather than
				// a flat "(Direct — same item)" string, per requirements.
				const isRM = it.isFG && b.rm;
				const componentCode = isRM ? b.rm : it.code;
				const componentName = isRM ? (b.rm_name || '') : (it.name || '');
				const componentCell = `${this.doc_link(componentCode, 'Item')}${componentName ? `<br><span class="st-muted">${frappe.utils.escape_html(componentName)}</span>` : ''}`;

				rows += `<tr>
					${leadCells}
					<td class="st-item-cell">${componentCell}</td>
					<td>${b.qty}</td>
					<td>${this.chip_link(b.src, null, 'src')}${b.via ? `<span class="st-via">${frappe.utils.escape_html(b.via)}</span>` : ''}</td>
					<td>${this.chip_link(b.po, null, 'po')}</td>
				</tr>`;
			});
		});

		body.html(rows || `<tr><td colspan="7" class="st-muted">${__('No data.')}</td></tr>`);
	}

	// `doctype` is optional — when given (e.g. 'Item' for the Items Summary
	// table), it's stamped onto the link so the click handler can route
	// straight there without needing to guess from the naming series.
	doc_link(name, doctype) {
		if (!name) return '<span class="st-muted">—</span>';
		const dtAttr = doctype ? ` data-doctype="${frappe.utils.escape_html(doctype)}"` : '';
		return `<a class="st-src-link st-doc-link" href="#" data-name="${frappe.utils.escape_html(name)}"${dtAttr}>${frappe.utils.escape_html(name)}</a>`;
	}

	// Pill-style "chip" link: small icon + document name, each `kind` given
	// its OWN colour family (see .st-chip-* CSS) so AO Number, Delivery
	// Note, Source Document and Purchase/Sub. Order never blur into one
	// flat link colour. `doctype` is optional — when omitted, clicking
	// falls back to guess_doctype() from the naming series (same as
	// doc_link()); AO chips always pass 'Project' explicitly since Project
	// names rarely follow a guessable prefix.
	chip_link(name, doctype, kind) {
		if (!name) return '<span class="st-muted">—</span>';
		const dtAttr = doctype ? ` data-doctype="${frappe.utils.escape_html(doctype)}"` : '';
		const iconMap = { ao: 'git', dn: 'file', src: 'layers', po: 'bar' };
		const ic = this.icon(iconMap[kind] || 'link', 12);
		return `<a class="st-chip st-chip-${kind || 'default'} st-doc-link" href="#" data-name="${frappe.utils.escape_html(name)}"${dtAttr}>${ic}<span>${frappe.utils.escape_html(name)}</span></a>`;
	}

	// Heuristic prefix -> doctype map so report/diagram links can jump straight
	// to the document. ADAPT this to your own naming series.
	guess_doctype(name) {
		const map = [
			[/^PR-/, 'Purchase Receipt'],
			[/^SCR-/, 'Subcontracting Receipt'],
			[/^SC-PO-/, 'Subcontracting Order'],
			[/^PO-/, 'Purchase Order'],
			[/^SE-/, 'Stock Entry'],
			[/^MR-/, 'Material Request'],
			[/^SO-/, 'Sales Order'],
			[/^DN-/, 'Delivery Note']
		];
		const hit = map.find(([re]) => re.test(name));
		return hit ? hit[1] : null;
	}

	/* ---------------------------------------------------------------- */
	/* export (call from console/menu if you want to wire it to a button) */
	/* ---------------------------------------------------------------- */

	export_csv() {
		if (!this.state.items.length) {
			frappe.msgprint(__('Nothing to export yet.'));
			return;
		}
		const header = ['AO Number', 'Delivery Note', 'Delivered Item', 'Delivered Qty', 'Component/RM', 'Qty', 'Source Document', 'Purchase Order'];
		const rows = [header];
		this.state.items.forEach(it => {
			(it.branches || []).forEach(b => {
				rows.push([
					it.ao || '', it.dn, it.code, it.delivered,
					b.untraced ? '' : (it.isFG ? (b.rm || it.code) : it.code),
					b.qty, b.untraced ? '' : (b.src || ''), b.untraced ? '' : (b.po || '')
				]);
			});
		});
		const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = `stock-traceability.csv`;
		link.click();
	}

	/* ---------------------------------------------------------------- */
	/* icons (same outline set as the Executive Dashboard, so pages match) */
	/* ---------------------------------------------------------------- */

	icon(name, size) {
		const I = {
			home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
			calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
			refresh: '<path d="M21 12a9 9 0 11-9-9c2.5 0 4.7 1 6.4 2.6L21 8M21 3v5h-5"/>',
			xcircle: '<circle cx="12" cy="12" r="10"/><line x1="14.5" y1="9.5" x2="9.5" y2="14.5"/><line x1="9.5" y1="9.5" x2="14.5" y2="14.5"/>',
			check: '<polyline points="20 6 9 17 4 12"/>',
			sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
			moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
			git: '<circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/>',
			bar: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
			file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
			layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
			info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
			inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
			filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
			link: '<path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L12.5 19.5"/>'
		};
		const s = size || 15;
		return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;">${I[name] || ''}</svg>`;
	}

	/* ---------------------------------------------------------------- */
	/* styles                                                             */
	/* ---------------------------------------------------------------- */

	inject_styles() {
		// If a previous version of the styles is already in the DOM (e.g. the
		// page was live during a bench update), remove it first so the new
		// STOCK_TRACEABILITY_CSS always wins instead of the stale cached one.
		const existing = document.getElementById('stock-traceability-styles');
		if (existing) existing.remove();
		const style = document.createElement('style');
		style.id = 'stock-traceability-styles';
		style.textContent = STOCK_TRACEABILITY_CSS;
		document.head.appendChild(style);
	}
}

function flt(v, p) { return frappe.utils.flt ? frappe.utils.flt(v, p) : Math.round((v || 0) * 100) / 100; }

// Design tokens intentionally mirror executive_dashboard.js's --exd-* palette
// (same Inter font, same primary indigo, same card/shadow language, same
// dark-mode strategy via [data-theme]) so both pages read as one product.
const STOCK_TRACEABILITY_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap');

.st-page {
	--st-bg: #f3f4f6;
	--st-surface: #ffffff;
	--st-border: #e5e7eb;
	--st-text: #111827;
	--st-text-2: #374151;
	--st-text-3: #6b7280;
	--st-primary: #6366f1;
	--st-primary-dark: #4f46e5;

	/* Dedicated connector-line colour — deliberately darker/higher-contrast
	   than --st-border (which is far too light to read as a "line" against
	   the canvas background). Used by every tree connector: root stem,
	   fork elbow, and the vertical stack line inside a single branch. */
	--st-line-color: #94a3b8;
	--st-line-color-strong: #64748b;

	--st-blue-bg: #eef1ff; --st-blue-border: #B9D0FF; --st-blue-text: #3B54DE;
	--st-green-bg: #e3fbee; --st-green-border: #A9EFC7; --st-green-text: #1A9A5C;
	--st-purple-bg: #f1ebfe; --st-purple-border: #D9C9FB; --st-purple-text: #7C3AED;
	--st-yellow-bg: #fff6de; --st-yellow-border: #FBE1A0; --st-yellow-text: #B4790C;
	--st-highlight-bg: #fdf6e3; --st-highlight-border: #f4e0a3;

	/* Frappe-theme colour family for the diagram legend + node types
	   (Delivery Document / Stock Movement-Receipt / Order Document /
	   Request Document / Warehouse) — mirrors Frappe Framework's own
	   indicator palette (blue/green/purple/orange/cyan) so the page reads
	   as "on-brand" rather than an arbitrary custom palette. */
	--st-fp-blue-bg: #eaf4fe; --st-fp-blue-border: #b8ddfb; --st-fp-blue-text: #1367c9;
	--st-fp-green-bg: #e6f9f0; --st-fp-green-border: #abe9cf; --st-fp-green-text: #1f8f5f;
	--st-fp-purple-bg: #f1ebfe; --st-fp-purple-border: #d9c9fb; --st-fp-purple-text: #6a2fd1;
	--st-fp-orange-bg: #fff3e0; --st-fp-orange-border: #ffd699; --st-fp-orange-text: #b56a00;
	--st-fp-cyan-bg: #e0f7fa; --st-fp-cyan-border: #80deea; --st-fp-cyan-text: #00838f;

	/* Chip colour families — one dedicated palette per link "kind" so AO
	   Number, Delivery Note, Source Document and Purchase/Sub. Order never
	   collapse into a single flat link colour (see chip_link()). */
	--st-ao-bg: #fff1e0; --st-ao-border: #f8c88a; --st-ao-text: #b45309;
	--st-dn-bg: #e6f0ff; --st-dn-border: #a9c8ff; --st-dn-text: #1d4ed8;
	--st-src-bg: #e3fbee; --st-src-border: #A9EFC7; --st-src-text: #157347;
	--st-po-bg: #f6ecff; --st-po-border: #ddc2fb; --st-po-text: #7c3aed;
	--st-default-bg: #eef2ff; --st-default-border: #c7d2fe; --st-default-text: #4338ca;

	--st-font-body: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	--st-font-display: 'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif;

	font-family: var(--st-font-body);
	font-size: 13px;
	color: var(--st-text);
	background: var(--st-bg);
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
}
.st-page * { box-sizing: border-box; }

.st-page[data-theme="dark"] {
	--st-bg: #14161f;
	--st-surface: #1c1f2b;
	--st-border: #2c2f3d;
	--st-text: #f3f4f6;
	--st-text-2: #cbd0dc;
	--st-text-3: #8b8fa3;

	/* Lighter, still clearly visible against the dark canvas. */
	--st-line-color: #6b7280;
	--st-line-color-strong: #9ca3af;

	--st-blue-bg: #1c2340; --st-blue-border: #33407a; --st-blue-text: #93a5ff;
	--st-green-bg: #103322; --st-green-border: #1f5c3c; --st-green-text: #4fd394;
	--st-purple-bg: #241c40; --st-purple-border: #453172; --st-purple-text: #b79bff;
	--st-yellow-bg: #3a2c10; --st-yellow-border: #6b4e10; --st-yellow-text: #fbbf24;
	--st-highlight-bg: #3a3320; --st-highlight-border: #6b5c20;

	--st-fp-blue-bg: #16324d; --st-fp-blue-border: #2b5f8f; --st-fp-blue-text: #7fc0ff;
	--st-fp-green-bg: #103322; --st-fp-green-border: #1f5c3c; --st-fp-green-text: #5fe0a0;
	--st-fp-purple-bg: #241c40; --st-fp-purple-border: #453172; --st-fp-purple-text: #c3a9ff;
	--st-fp-orange-bg: #3a2c10; --st-fp-orange-border: #6b4e10; --st-fp-orange-text: #ffc266;
	--st-fp-cyan-bg: #0d3336; --st-fp-cyan-border: #14606a; --st-fp-cyan-text: #5fe0ea;

	--st-ao-bg: #3a2a10; --st-ao-border: #7a5320; --st-ao-text: #fbbf6a;
	--st-dn-bg: #1c2b4a; --st-dn-border: #2f4b8a; --st-dn-text: #8fb2ff;
	--st-src-bg: #103322; --st-src-border: #1f5c3c; --st-src-text: #5fe0a0;
	--st-po-bg: #2a1c40; --st-po-border: #4a3372; --st-po-text: #cbb0ff;
	--st-default-bg: #22254a; --st-default-border: #3d4380; --st-default-text: #a5b4fc;
}

.st-shell {
	max-width: 100%;
	margin: 0;
	padding: 16px 24px 32px 24px;
}

/* Filter bar — Company / AO Number / Sales Order / Delivery Note + Reset /
   Refresh / Theme, all on ONE single row, at any viewport width. Every
   field/button has a FIXED width (not a flex-grow/shrink guess) so it can
   never reflow, jump, or wrap as controls render/refresh, and the widths
   below are chosen to actually fit together on one line on a normal
   desk width. If the window is ever too narrow to fit everything, the bar
   scrolls horizontally instead of wrapping to a second line. */
.st-filter-bar {
	background: var(--st-surface);
	border: 1px solid var(--st-border);
	border-radius: 12px;
	padding: 12px 18px;
	display: flex;
	margin-bottom: 10px;
	box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.st-filter-row {
	display: flex;
	align-items: flex-start;
	gap: 14px;
	flex-wrap: wrap;
	row-gap	: 12px;
	width: 100%;
}
.st-field { position: relative; }
.st-field-company, .st-field-ao, .st-field-so, .st-field-dn {
	flex: 0 0 260px;
	width: 260px;
	min-width: 260px;
	max-width: 260px;
}

/* Icon sits inside the control's own input-wrapper, centered against the
   actual input box — independent of label length or outer field height,
   so it can never drift below/outside the box (see attach_field_icon()). */
.control-input-wrapper.st-has-icon { position: relative; }
.control-input-wrapper.st-has-icon > svg {
	position: absolute;
	left: 10px;
	top: 50%;
	transform: translateY(-50%);
	color: var(--st-text-3);
	pointer-events: none;
	z-index: 2;
}
.control-input-wrapper.st-has-icon input,
.control-input-wrapper.st-has-icon select,
.control-input-wrapper.st-has-icon .awesomplete input {
	padding-left: 32px !important;
}

/* Form control sizing so Link controls sit flush inside the filter bar
   (frappe.ui.form.make_control renders full desk-form markup by default,
   which is taller/looser than the bar wants). */
.st-field .frappe-control { min-width: 0; }
.st-field .frappe-control .control-label { font-size: 11px; line-height: 15px; font-weight: 700; color: var(--st-text-3); text-transform: uppercase; letter-spacing: .4px; margin-bottom: 4px; white-space: nowrap; }
.st-field .frappe-control .control-input-wrapper { min-height: 0; }
.st-field input, .st-field select {
	width: 100%;
	height: 36px;
	border-radius: 8px;
	border: 1px solid var(--st-border);
	background: var(--st-bg);
	color: var(--st-text);
	font-size: 13px;
	font-weight: 600;
	transition: background .15s ease, border-color .15s ease;
}
.st-field input:hover, .st-field select:hover { background: var(--st-surface); border-color: var(--st-primary); }
.st-field input:focus, .st-field select:focus { background: var(--st-surface); border-color: var(--st-primary); box-shadow: 0 0 0 2px rgba(99,102,241,.15); }

/* ------------------------------------------------------------------ */
/* Delivery Note — custom button + dialog multi-select (NOT Frappe's    */
/* MultiSelectList — see the header comment in the JS for why). The     */
/* trigger button is styled to match the other 36px filter inputs      */
/* exactly, and never grows/collapses no matter how many DNs are        */
/* selected — it always shows an honest "N selected" count.             */
/* ------------------------------------------------------------------ */
.st-field-dn { display: flex; flex-direction: column; min-width: 0; }
.st-dn-label { font-size: 11px; line-height: 15px; font-weight: 700;margin-top:4px!important;	 color: var(--st-text-3); text-transform: uppercase; letter-spacing: .4px; margin-bottom: 4px; white-space: nowrap; display: block; }
.st-dn-required { color: #ef4444; font-weight: 800; }
.st-dn-trigger {
	height: 36px;
	border-radius: 8px;
	border: 1px solid var(--st-border);
	background: var(--st-bg);
	color: var(--st-text-3);
	font-size: 13px;
	font-weight: 600;
	display: flex;
	align-items: center;
	justify-content: space-between;
	// margin-top:4px!important;	
	gap: 8px;
	padding: 0 12px;
	cursor: pointer;
	transition: all .15s ease;
	width: 100%;
	font-family: var(--st-font-body);
}
.st-dn-trigger:hover, .st-dn-trigger:focus {
	background: var(--st-surface);
	border-color: var(--st-primary);
	outline: none;
	box-shadow: 0 0 0 2px rgba(99,102,241,.15);
}
.st-dn-trigger.has-value { color: var(--st-text); }
.st-dn-trigger svg { color: var(--st-text-3); flex-shrink: 0; }
.st-dn-trigger-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Delivery Note dialog — checkmark-style rows (title + description),
   click-to-toggle, soft highlight on the selected row. Replaces the old
   plain checkbox list so it reads the same as the other multi-select
   pickers used elsewhere in the app. */
.st-dn-option-list {
	max-height: 340px;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 2px;
	margin-top: 8px;
}
.st-dn-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	padding: 9px 10px;
	border-radius: 7px;
	cursor: pointer;
	transition: background .12s ease;
}
.st-dn-row:hover { background: var(--st-bg); }
.st-dn-row.is-selected { background: var(--st-highlight-bg); }
.st-dn-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.st-dn-row-title { font-weight: 700; font-size: 13px; color: var(--st-text); }
.st-dn-row-desc { font-size: 11.5px; color: var(--st-text-3); }
.st-dn-check-icon { display: flex; align-items: center; color: var(--st-primary); flex-shrink: 0; }

.st-filter-divider {
	width: 1px;
	align-self: stretch;
	background: var(--st-border);
	margin: 2px 2px;
	flex-shrink: 0;
}

.st-filter-right {
	flex: 0 0 auto;
	margin-left: auto;
	display: flex;
	flex-direction: column;
	white-space: nowrap;
}
/* Invisible spacer with the EXACT same font-size/line-height/margin as a
   field's own label (.control-label / .st-dn-label above), so the button
   row below it lands on precisely the same horizontal line as every
   input box — not an approximation via align-self. */
.st-filter-right-spacer {
	font-size: 11px;
	line-height: 15px;
	margin-bottom: 4px;
	visibility: hidden;
}
.st-filter-right-buttons {
	display: flex;
	align-items: center;
	gap: 8px;
	height: 36px;
}
.st-icon-btn {
	height: 36px;
	padding: 0 14px;
	border-radius: 8px;
	border: 1px solid var(--st-border);
	background: var(--st-surface);
	color: var(--st-text-2);
	display: flex;
	align-items: center;
	gap: 7px;
	cursor: pointer;
	font-family: var(--st-font-display);
	font-size: 13px;
	font-weight: 700;
	letter-spacing: .1px;
	transition: all .2s;
	white-space: nowrap;
}
.st-icon-btn:hover { background: var(--st-bg); border-color: var(--st-primary); color: var(--st-primary); }
.st-icon-btn:disabled { opacity: .6; cursor: default; }
.st-icon-btn-ghost { color: var(--st-text-3); }
.st-icon-btn-ghost:hover { background: var(--st-bg); border-color: #ef4444; color: #ef4444; }
#st-refresh {
	background: linear-gradient(135deg, var(--st-primary), var(--st-primary-dark));
	border-color: transparent;
	color: #fff;
	box-shadow: 0 2px 8px rgba(99,102,241,.28);
}
#st-refresh:hover { background: linear-gradient(135deg, var(--st-primary-dark), var(--st-primary-dark)); color: #fff; box-shadow: 0 4px 12px rgba(99,102,241,.38); }
#st-refresh:disabled { box-shadow: none; }
#st-theme-toggle { width: 36px; padding: 0; justify-content: center; }
.st-refresh-label { white-space: nowrap; }
#st-refresh.is-loading svg { animation: st-spin .7s linear infinite; }
@keyframes st-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.st-hint {
	font-size: 12px;
	margin: 0 0 10px 2px;
	font-weight: 600;
	color: var(--st-primary);
	display: flex;
	align-items: center;
	gap: 6px;
	letter-spacing: .1px;
}
.st-hint.st-required-hint {
	background: linear-gradient(90deg, rgba(99,102,241,.10), rgba(99,102,241,.03));
	border: 1px solid rgba(99,102,241,.25);
	border-radius: 8px;
	padding: 7px 12px;
	margin: 0 0 12px 0;
	color: var(--st-primary-dark);
}
.st-page[data-theme="dark"] .st-hint.st-required-hint { color: #a5b4fc; }

/* Small red asterisk after the AO / Sales Order labels to signal that
   picking at least ONE of the three (AO / SO / DN) is required. The
   Delivery Note field's own asterisk is rendered directly in its markup
   (.st-dn-required) since it's no longer a Frappe control-label. */
.st-field-ao .control-label::after,
.st-field-so .control-label::after {
	content: " *";
	color: #ef4444;
	font-weight: 800;
}

/* Tabs */
.st-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--st-border); margin-bottom: 18px; flex-wrap: wrap; }
.st-tab {
	padding: 10px 16px; font-family: var(--st-font-display); font-size: 13px; font-weight: 700;
	letter-spacing: .1px; color: var(--st-text-3); cursor: pointer; border-bottom: 2px solid transparent;
	margin-bottom: -1px; display: flex; align-items: center; gap: 6px; border-radius: 6px 6px 0 0;
	transition: color .15s ease, background .15s ease;
}
.st-tab:hover { color: var(--st-primary-dark); background: rgba(99,102,241,.05); }
.st-tab.active { color: var(--st-primary); border-bottom-color: var(--st-primary); }
.st-tab-panel { display: none; }
.st-tab-panel.active { display: block; }

/* Scoped loading overlay — covers ONLY the results panel (tables + item
   list + diagram), never the sidebar/navbar/rest of the Desk. Replaces the
   old full-page frappe.dom.freeze(), which used to visibly flash the whole
   screen grey on every AO / Sales Order / Delivery Note change. */
.st-panels-wrap { position: relative; }
.st-loading-overlay {
	position: absolute;
	inset: 0;
	z-index: 20;
	display: flex;
	align-items: center;
	justify-content: center;
	
	gap: 10px;
	background: rgba(255,255,255,.78);
	backdrop-filter: blur(1px);
	border-radius: 16px;
	font-family: var(--st-font-display);
	font-size: 13px;
	font-weight: 700;
	color: var(--st-primary-dark);
	opacity: 0;
	pointer-events: none;
	transition: opacity .15s ease;
}
.st-loading-overlay.is-active { opacity: 1; pointer-events: all; }
.st-page[data-theme="dark"] .st-loading-overlay { background: rgba(20,22,31,.78); color: #a5b4fc; }
.st-spinner {
	width: 18px; height: 18px; border-radius: 50%;
	border: 2.5px solid rgba(99,102,241,.25);
	border-top-color: var(--st-primary);
	animation: st-spin .7s linear infinite;
}

/* Cards */
.st-card {
	background: var(--st-surface);
	border-radius: 16px;
	padding: 20px 22px;
	border: 1px solid var(--st-border);
	box-shadow: 0 1px 2px rgba(16,24,40,0.04), 0 4px 12px -4px rgba(16,24,40,0.06);
	margin-bottom: 18px;
	transition: box-shadow .25s ease, border-color .25s ease;
}
.st-anim { opacity: 0; animation: st-slide-up .4s cubic-bezier(.16,1,.3,1) forwards; animation-delay: calc(var(--delay, 0) * 0.05s); }
@keyframes st-slide-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

.st-section-title {
	font-family: var(--st-font-display); font-size: 15px; font-weight: 800; letter-spacing: -.1px;
	margin: 0 0 12px; display: flex; align-items: center; gap: 7px; color: var(--st-text);
}
.st-section-title svg { color: var(--st-primary); }
.st-muted { color: var(--st-text-3); font-size: 12px; }

.st-select-prompt {
	display: flex; align-items: center; justify-content: center; gap: 8px;
	padding: 22px 12px; font-size: 13px; font-weight: 600; color: var(--st-primary-dark);
	font-family: var(--st-font-display);
}
.st-page[data-theme="dark"] .st-select-prompt { color: #a5b4fc; }
.st-empty-state--prompt svg { color: var(--st-primary); opacity: .55; }
.st-empty-state--prompt p { color: var(--st-primary-dark); font-family: var(--st-font-display); }
.st-page[data-theme="dark"] .st-empty-state--prompt p { color: #a5b4fc; }

/* Tables */
.st-table-scroll { overflow-x: auto; }
.st-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 860px; }
.st-table thead th {
	text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .4px;
	color: var(--st-text-3); padding: 9px 12px; border-bottom: 1px solid var(--st-border);
	font-weight: 700; white-space: nowrap;
}
.st-table tbody td { padding: 10px 12px; border-bottom: 1px solid var(--st-border); vertical-align: top; color: var(--st-text-2); }
.st-table tbody tr:last-child td { border-bottom: none; }
.st-table tbody tr.st-selectable-row { cursor: pointer; transition: background .15s ease; }
.st-table tbody tr.st-selectable-row:hover { background: rgba(99,102,241,.06); }
.st-table tbody tr.st-selectable-row.is-active td { background: rgba(99,102,241,.09); }

.st-pct-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-weight: 700; font-size: 12px; }
.st-pct-pill.full { background: var(--st-green-bg); color: var(--st-green-text); }
.st-pct-pill.partial { background: var(--st-yellow-bg); color: var(--st-yellow-text); }
.st-pct-pill.skipped { background: var(--st-bg); color: var(--st-text-3); font-weight: 600; }

/* ------------------------------------------------------------------ */
/* Chip links — pill-shaped icon+name links used for AO Number,        */
/* Delivery Note, Source Document and Purchase/Sub. Order. Each kind */

.st-chip {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 4px 10px 4px 8px;
	border-radius: 20px;
	border: 1px solid var(--st-default-border);
	background: var(--st-default-bg);
	color: var(--st-default-text);
	font-weight: 700;
	font-size: 12px;
	text-decoration: none;
	white-space: nowrap;
	line-height: 1.3;
	transition: transform .12s ease, box-shadow .12s ease, filter .12s ease;
}
.st-chip svg { flex-shrink: 0; opacity: .85; }
.st-chip:hover {
	text-decoration: none;
	filter: brightness(0.97);
	transform: translateY(-1px);
	box-shadow: 0 3px 8px rgba(16,24,40,.10);
}
.st-page[data-theme="dark"] .st-chip:hover { box-shadow: 0 3px 10px rgba(0,0,0,.35); }

.st-chip-ao { background: var(--st-ao-bg); border-color: var(--st-ao-border); color: var(--st-ao-text); }
.st-chip-dn { background: var(--st-dn-bg); border-color: var(--st-dn-border); color: var(--st-dn-text); }
.st-chip-src { background: var(--st-src-bg); border-color: var(--st-src-border); color: var(--st-src-text); }
.st-chip-po { background: var(--st-po-bg); border-color: var(--st-po-border); color: var(--st-po-text); }

.st-item-ao { margin: -4px 0 8px; }

/* Flow layout */
.st-flow-layout { display: grid; grid-template-columns: 300px 1fr; gap: 18px; align-items: start; }
.st-item-list-head { margin-bottom: 10px; }
.st-item-list-head h3 { font-family: var(--st-font-display); font-size: 15px; font-weight: 800; letter-spacing: -.1px; margin: 0 0 2px; color: var(--st-text); }
.st-item-list-head p { margin: 0; font-size: 12px; color: var(--st-text-3); }

.st-item-card {
	border: 1px solid var(--st-border); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px;
	cursor: pointer; background: var(--st-surface); transition: all .15s ease;
}
.st-item-card:hover { box-shadow: 0 2px 10px rgba(16,24,40,.08); }
.st-item-card.is-active { border-color: var(--st-primary); background: rgba(99,102,241,.07); box-shadow: 0 4px 14px rgba(99,102,241,.15); }
.st-item-row1 { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.st-item-code { font-family: var(--st-font-display); font-weight: 700; font-size: 13.5px; letter-spacing: -.05px; color: var(--st-text); }
.st-item-delivered { font-size: 11px; color: var(--st-text-3); white-space: nowrap; }
.st-item-delivered b { color: var(--st-text); font-size: 13px; }
.st-item-name { font-size: 12px; color: var(--st-text-3); margin: 2px 0 8px; }
.st-item-row2 { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--st-text-3); gap: 8px; }
.st-badge-pct { font-weight: 700; padding: 2px 9px; border-radius: 20px; font-size: 11px; white-space: nowrap; }
.st-badge-pct.full { background: var(--st-green-bg); color: var(--st-green-text); }
.st-badge-pct.partial { background: var(--st-yellow-bg); color: var(--st-yellow-text); }
.st-badge-pct.skipped { background: var(--st-bg); color: var(--st-text-3); }

.st-empty-state {
	display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
	padding: 48px 20px; color: var(--st-text-3); text-align: center;
}
.st-empty-state svg { color: var(--st-text-3); opacity: .6; }
.st-empty-state p { margin: 0; font-size: 13px; font-weight: 600; }

.st-empty-state--untraced {
	background: #fdecea;
	border: 1px dashed #f3b8b0;
	border-radius: 12px;
	margin: 6px 8px 0;
	padding: 36px 20px;
}
.st-empty-state--untraced svg { color: #c0362c; opacity: .8; }
.st-empty-state--untraced p { color: #b3382f; max-width: 420px; margin: 0 auto; }
.st-page[data-theme="dark"] .st-empty-state--untraced { background: #3a1f1f; border-color: #6b3630; }
.st-page[data-theme="dark"] .st-empty-state--untraced svg { color: #ff8f87; }
.st-page[data-theme="dark"] .st-empty-state--untraced p { color: #ff9d95; }

/* Diagram card — a fully "boxed" card like the other panels (border +
   background + shadow), so the whole flow diagram + info bar + legend
   reads as one clearly framed unit. */
.st-diagram-card {
	position: relative;
	min-height: 400px;
	padding: 0 18px 18px;
	background: var(--st-surface);
	border: 1.5px solid var(--st-border);
	border-radius: 18px;
	overflow: hidden;
	box-shadow: 0 2px 4px rgba(16,24,40,0.05), 0 10px 26px -8px rgba(16,24,40,0.14);
}
/* Colored accent bar across the very top of the box, so the whole
   diagram — header row + canvas + legend — reads as one deliberately
   framed unit rather than loose content on the page. */
.st-diagram-card::before {
	content: '';
	position: absolute;
	top: 0; left: 0; right: 0;
	height: 5px;
	background: linear-gradient(90deg, #2490ef, #7c3aed 45%, #1f9d63 75%, #e08e0b);
}
.st-diagram-toolbar {
	margin: 0 -18px 18px;
	padding: 20px 18px 16px;
	background: linear-gradient(180deg, rgba(99,102,241,.06), rgba(99,102,241,0));
	border-bottom: 1px solid var(--st-border);
}
.st-diagram-info { display: flex; gap: 30px; flex-wrap: wrap; font-size: 13px; justify-content: center; text-align: center; align-items: flex-start; }
.st-diagram-info span { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.st-diagram-info > span:nth-child(2) { flex: 1 1 auto; min-width: 0; max-width: 480px; }
.st-info-label { font-size: 10px; font-weight: 700; color: var(--st-text-3); text-transform: uppercase; letter-spacing: .4px; }
.st-diagram-info b { color: var(--st-text); font-size: 13px; }
.st-diag-item-line {
	display: inline-flex;
	align-items: baseline;
	max-width: 100%;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	vertical-align: bottom;
}
.st-diag-item-name { color: var(--st-text-3); font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.st-pct-pill-lg { font-size: 13px; padding: 4px 12px; }
.st-pct-pill.zero { background: #fde3e3; color: #c0362c; }
.st-page[data-theme="dark"] .st-pct-pill.zero { background: #4a1f1f; color: #ff8f87; }

/* The flow chart itself sits inside its own clearly bounded box — a
   dashed frame with a faint tint — nested inside the outer diagram card,
   so the node chain and the untraced/opening-stock callout both read as
   "contained" rather than floating loose on white space. */
.st-flow-canvas {
	padding: 30px 16px 26px;
	overflow-x: auto;
	margin: 4px 2px 0;
	border: 1.5px dashed var(--st-border);
	border-radius: 14px;
	background: var(--st-bg);
}
.st-page[data-theme="dark"] .st-flow-canvas { background: rgba(255,255,255,.02); }
.st-root-node {
	display: block;
	width: 230px; margin: 0 auto; text-align: center; border-radius: 10px; padding: 11px 12px; color: #fff;
	background: linear-gradient(135deg, #2490ef, #1367c9);
	box-shadow: 0 6px 16px rgba(36,144,239,.35);
	text-decoration: none;
	position: relative;
	cursor: pointer;
	transition: transform .15s ease, box-shadow .15s ease;
}
.st-root-node:hover { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(36,144,239,.45); text-decoration: none; }
.st-root-node .st-node-t { font-family: var(--st-font-display); font-weight: 800; font-size: 13.5px; letter-spacing: .1px; }
.st-root-node .st-node-s { font-size: 11px; color: rgba(255,255,255,.85); margin-top: 2px; }

/* Vertical stem connecting the root Delivery Note node down into the
   branch row below it. Previously there was NO line at all here. */
.st-root-stem {
	width: 2px;
	height: 26px;
	margin: 0 auto;
	background: var(--st-line-color-strong);
}

/* ------------------------------------------------------------------ */
/* Tree connector lines (branch row + fork elbow)                      */
/* ------------------------------------------------------------------ */
/* .st-branch-row lays out one or more sibling columns (.st-branch). When
   there's more than one sibling (a genuine fork — e.g. two Subcontracting
   Receipts feeding the same item), each sibling gets:
	 - a horizontal bar across the TOP half of its own column, clipped so
	   the combined bars of every sibling in the row form one continuous
	   line spanning from the center of the first sibling to the center
	   of the last (the classic "org chart" elbow technique — pure CSS,
	   no JS measurement needed);
	 - a short vertical stem dropping from that bar down into its own
	   node.
   A single (unforked) branch skips the horizontal bar entirely (see
   .is-single) and only keeps a short vertical lead-in stem, since there's
   nothing to fork from. */
.st-branch-row {
	display: flex; justify-content: center; gap: 0; margin-top: 0; flex-wrap: nowrap; width: 100%;
}

.st-branch {
	display: flex; flex-direction: column; align-items: center;
	position: relative;
	padding-top: 22px;
	padding-left: 30px; padding-right: 30px;
	flex: 0 0 auto;   /* never shrink below content+padding — spacing stays constant at every nesting depth */
}

.st-branch-chain {
	display: flex;
	flex-direction: column;
	align-items: center;
}

/* Vertical stem — every branch gets one, dropping from the fork line (or,
   for a single branch, standing in as the lead-in line from the row
   above) down to the top of its own qty label / node. */
.st-branch::before {
	content: '';
	position: absolute;
	top: 0; left: 50%;
	width: 2px; height: 22px;
	background: var(--st-line-color-strong);
	transform: translateX(-50%);
}
/* Horizontal fork bar — full width by default, then clipped per position
   so the visible line only spans first-sibling-center to last-sibling-
   center, never running off past the outer edges of the row. */
.st-branch-row:not(.is-single) > .st-branch::after {
	content: '';
	position: absolute;
	top: 0; left: 0; right: 0;
	height: 2px;
	background: var(--st-line-color);
}
.st-branch-row:not(.is-single) > .st-branch:first-child::after { left: 50%; }
.st-branch-row:not(.is-single) > .st-branch:last-child::after { right: 50%; }
.st-branch-row.is-single > .st-branch::after { display: none; }

.st-qty-label {
	font-size: 11px; color: var(--st-primary); font-weight: 700; margin: 0 0 8px;
	background: var(--st-surface); padding: 0 6px; position: relative; z-index: 1;
}
.st-node {
	display: block;
	width: 200px; text-align: center; border-radius: 9px; padding: 0; font-size: 12px; border: 1px solid; margin-bottom: 6px; box-shadow: 0 1px 2px rgba(16,24,40,.05);
	position: relative;
	overflow: hidden;
}

/* Real flex row (not absolute) so the browser actually reserves space for
   the side box — this is what makes .st-branch's natural width grow to
   include it, which (combined with flex:0 0 auto on .st-branch) pushes
   the NEXT sibling column further right automatically. No more overlap. */
.st-node-with-side {
	display: flex;
	align-items: center;
	justify-content: center;
	margin: 0 auto 6px;
	width: fit-content;
}
.st-node-with-side .st-node { margin-bottom: 0; flex: 0 0 200px; }

.st-node-side-connector {
	position: relative;
	flex: 0 0 30px;
	height: 2px;
	background: var(--st-line-color-strong);
}
.st-node-side-connector::after {
	content: '';
	position: absolute;
	right: -1px; top: 50%;
	width: 0; height: 0;
	border-top: 4px solid transparent;
	border-bottom: 4px solid transparent;
	border-left: 6px solid var(--st-line-color-strong);
	transform: translateY(-50%);
}

.st-node-side { margin-bottom: 0 !important; flex: 0 0 200px; }


.st-node-inner { display: block; padding: 9px 10px; text-decoration: none; color: inherit; }
.st-node-t { font-family: var(--st-font-display); font-weight: 700; font-size: 12.5px; letter-spacing: -.05px; }
.st-node-s { font-size: 11px; color: var(--st-text-3); margin-top: 2px; }

/* Connector line between stacked nodes WITHIN one branch (e.g. Purchase
   Receipt -> Purchase Order). Made a clearly-visible solid line — darker
   and thicker than the old 1px --st-border line, with a small filled
   circle where it meets the node above it so the join reads as
   deliberate rather than a stray hairline. */
.st-connector {
	width: 2px; height: 18px; margin: 0 auto 6px;
	background: var(--st-line-color-strong);
	position: relative;
}
.st-connector::before {
	content: '';
	position: absolute; top: -3px; left: 50%; transform: translateX(-50%);
	width: 6px; height: 6px; border-radius: 50%;
	background: var(--st-line-color-strong);
}

.st-node-doc { background: var(--st-fp-green-bg); border-color: var(--st-fp-green-border); color: var(--st-fp-green-text); }
.st-node-order { background: var(--st-fp-purple-bg); border-color: var(--st-fp-purple-border); color: var(--st-fp-purple-text); }
.st-node-request { background: var(--st-fp-orange-bg); border-color: var(--st-fp-orange-border); color: var(--st-fp-orange-text); }
.st-node-warehouse { background: var(--st-fp-cyan-bg); border-color: var(--st-fp-cyan-border); color: var(--st-fp-cyan-text); }

/* Clickable diagram nodes (see node_doctype()/node_html()) — a small "open"
   glyph appears on hover, plus a lift + stronger shadow/border so it's
   obvious the node is a real, openable document and not just a label. */
.st-node-clickable { cursor: pointer; }
.st-node-clickable:hover {
	text-decoration: none;
	filter: brightness(0.98);
}
.st-node:has(.st-node-clickable:hover) {
	transform: translateY(-2px);
	box-shadow: 0 8px 18px rgba(16,24,40,.16);
}
.st-node-open {
	position: absolute; top: 6px; right: 7px;
	opacity: 0; transition: opacity .15s ease;
	color: inherit;
}
.st-node-clickable:hover .st-node-open,
.st-root-node:hover .st-node-open-root { opacity: .65; }
.st-node-open-root { color: #fff; }

/* Meta panel — attached under a node (the "Raw Material Consumed"
   subcontracting node, and the diagnostic hint on untraced nodes) showing
   extra detail: source SLE, RM item code, RM qty vs main item qty. Kept
   compact and plain-text where a link doesn't add real value (RM Item is
   now a plain code label, not a link — see node_html()). Sits INSIDE the
   same .st-node box, below the clickable inner surface, so it never
   becomes part of the node's own click target. */
.st-node-meta {
	margin-top: 0; padding: 7px 10px 8px;
	border-top: 1px dashed var(--st-line-color);
	font-size: 10.5px; color: var(--st-text-3); text-align: left;
	background: rgba(0,0,0,.015);
}
.st-page[data-theme="dark"] .st-node-meta { background: rgba(255,255,255,.03); }
.st-node-meta > div { margin-bottom: 2px; }
.st-node-meta > div:last-child { margin-bottom: 0; }
.st-node-meta-link { color: var(--st-primary); font-weight: 700; text-decoration: none; }
.st-node-meta-link:hover { text-decoration: underline; }
.st-node-meta-code { color: var(--st-text-2); font-weight: 700; }

/* Legend — boxed + centered, and each chip is a real clickable button that
   highlights matching nodes in the diagram (see apply_legend_filter()).
   Includes an "All" chip that clears any active highlight. */
.st-legend-wrap { display: flex; justify-content: center; margin-top: 26px; }
.st-legend {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
	justify-content: center;
	padding: 10px 16px;
	border: 1px solid var(--st-border);
	border-radius: 14px;
	background: var(--st-surface);
	box-shadow: 0 1px 3px rgba(16,24,40,.05);
}
.st-legend-item {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	background: none;
	border: 1px solid transparent;
	cursor: pointer;
	font-family: var(--st-font-body);
	font-size: 12px;
	font-weight: 600;
	color: var(--st-text-3);
	padding: 5px 10px;
	border-radius: 20px;
	transition: all .15s ease;
}
.st-legend-item:hover { background: var(--st-bg); color: var(--st-text); }
.st-legend-item.is-active {
	background: rgba(36,144,239,.12);
	border-color: rgba(36,144,239,.35);
	color: var(--st-fp-blue-text);
}

.st-tree-wrap {
	display: flex;
	flex-direction: column;
	align-items: center;   /* guarantees root node, stem, and branch row share one true center */
	width: fit-content;
	margin: 0 auto;
}
.st-tree-wrap .st-root-node { margin: 0; }      /* centering now comes from the wrap, not margin:auto */
.st-tree-wrap .st-root-stem { margin: 0; }
.st-tree-wrap .st-branch-row {
	width: fit-content;   /* shrink to its actual columns so the fork bar's 50%/50% clip lines up exactly */
}
	
.st-legend-all { font-weight: 800; border-color: var(--st-border) !important; }
.st-legend-all.is-active { background: rgba(99,102,241,.12); border-color: rgba(99,102,241,.35) !important; color: var(--st-primary-dark); }
.st-dot { width: 11px; height: 11px; border-radius: 3px; display: inline-block; flex-shrink: 0; }

/* Clicking a legend chip dims every node EXCEPT the matching type, and
   gives the matches a little "pop" (scale + shadow) so they're easy to
   spot at a glance in a busy trace. */
.st-flow-canvas[data-legend-filter] .st-node,
.st-flow-canvas[data-legend-filter] .st-root-node {
	opacity: .28;
	filter: grayscale(45%);
	transition: opacity .2s ease, filter .2s ease, transform .2s ease, box-shadow .2s ease;
}
.st-flow-canvas[data-legend-filter="dn"] .st-root-node,
.st-flow-canvas[data-legend-filter="doc"] .st-node-doc,
.st-flow-canvas[data-legend-filter="order"] .st-node-order,
.st-flow-canvas[data-legend-filter="request"] .st-node-request,
.st-flow-canvas[data-legend-filter="warehouse"] .st-node-warehouse {
	opacity: 1;
	filter: none;
	transform: scale(1.04);
	box-shadow: 0 6px 16px rgba(16,24,40,.18);
}

/* Report tab */
.st-report-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; }
.st-report-sub { margin: 0; font-size: 12px; color: var(--st-text-3); }
.st-report-table { min-width: 900px; }
.st-report-table td.st-item-cell { font-weight: 700; white-space: nowrap; }
.st-report-table td.st-dim { color: transparent; user-select: none; }
.st-src-link { color: var(--st-primary); font-weight: 700; text-decoration: none; }
.st-src-link:hover { text-decoration: underline; }
.st-via { font-size: 11px; color: var(--st-text-3); display: block; margin-top: 1px; }

/* Responsive */
@media (max-width: 1024px) {
	.st-flow-layout { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
	.st-shell { padding: 8px 12px; }
	.st-card { padding: 14px 16px; }
	/* Still ONE line on mobile — just narrower fixed fields, all the same
	   size, with the row scrolling sideways (swipe) instead of wrapping. */
	.st-field-company, .st-field-ao, .st-field-so, .st-field-dn {
		flex: 0 0 220px; width: 220px; min-width: 220px; max-width: 220px;
	}
}
`;