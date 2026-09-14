// jasma/jasma/page/employee_dashboard/employee_dashboard.js

frappe.pages["employee-dashboard"].on_page_load = function (wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Documents Dashboard"),
        single_column: true,
    });

    const methodRoot = "jasma.jasma.page.employee_dashboard.employee_dashboard.";

    const state = {
        filters: {
            period_preset: "yearly",
            company: "Jasma Engineering LLP",
            customer: null,
            status: null,
            from_date: null,
            to_date: null,
        },
        data: null,
        theme: localStorage.getItem("exd_theme") || "light",
        companies: [],
        customers: [],
    };

    const $page = $(wrapper).find(".page-content");
    $page.css("padding", "0");
    injectStyles();
    $page.addClass("exd-page").html(getLayout());
    applyTheme();

    bindEvents();
    setupDatePickers();
    loadFilterOptions();
    loadPageData();

    // ============================================================
    // THEME HANDLING
    // ============================================================
    function applyTheme() {
        $page.attr("data-theme", state.theme);
        $("#exd-theme-toggle").html(iconSvg(state.theme === "dark" ? "sun" : "moon"));
        $("#exd-theme-toggle").attr(
            "title",
            state.theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"
        );
        $("body").toggleClass("exd-calendar-dark", state.theme === "dark");
    }

    function toggleTheme() {
        state.theme = state.theme === "dark" ? "light" : "dark";
        localStorage.setItem("exd_theme", state.theme);
        applyTheme();
    }

    // ============================================================
    // LAYOUT HTML
    // ============================================================
    function getLayout() {
        return `
        <div class="exd-shell">

            <!-- Filter Bar: Compact Single Line with Reduced Widths, Custom Range Below -->
            <div class="exd-filter-bar">
                <div class="exd-filter-row">
                    <div class="exd-field exd-field-icon">
                        ${iconSvg("home")}
                        <select id="exd-company">
                            <option value="">All Companies</option>
                            ${getCompanyOptions()}
                        </select>
                    </div>
                    <div class="exd-field exd-field-icon">
                        ${iconSvg("users")}
                        <select id="exd-customer">
                            <option value="">All Customers</option>
                        </select>
                    </div>
                    <div class="exd-field exd-field-icon">
                        ${iconSvg("calendar")}
                        <select id="exd-period">
                            <option value="yearly" selected>This Financial Year</option>
                            <option value="previous_fy">Previous Financial Year</option>
                            <option value="quarterly">Quarterly (Last 3 Months)</option>
                            <option value="monthly">Monthly</option>
                            <option value="last_30_days">Last 30 Days</option>
                            <option value="weekly">Weekly</option>
                            <option value="custom">Custom Range</option>
                        </select>
                    </div>

                    <!-- Compact In-line Date Range Display on Same Line -->
                    <div class="exd-inline-date-pill" id="exd-inline-date-display" title="Active Date Period">
                        <span id="exd-display-from">--</span>
                        <span class="to-sep">to</span>
                        <span id="exd-display-to">--</span>
                    </div>

                    <div class="exd-filter-right">
                        <button class="exd-icon-btn" id="exd-theme-toggle" title="Switch to Dark Mode">${iconSvg("moon")}</button>
                        <button class="exd-icon-btn" id="exd-refresh" title="Refresh">${iconSvg("refresh")}</button>
                    </div>
                </div>

                <!-- Custom Range Row: Displayed Below when Custom Range is Chosen -->
                <div id="exd-custom-range-bar" class="exd-custom-range-bar hidden">
                    <div class="exd-field exd-field-icon">
                        ${iconSvg("calendar")}
                        <input type="text" id="exd-date-from" class="exd-date-input" title="From Date" placeholder="From Date" autocomplete="off" readonly>
                    </div>
                    <span class="to-sep">to</span>
                    <div class="exd-field exd-field-icon">
                        ${iconSvg("calendar")}
                        <input type="text" id="exd-date-to" class="exd-date-input" title="To Date" placeholder="To Date" autocomplete="off" readonly>
                    </div>
                    <button class="exd-btn exd-btn-primary" id="exd-apply-range">Apply</button>
                    <button class="exd-btn exd-btn-cancel" id="exd-cancel-range">Cancel</button>
                </div>
            </div>

            <!-- Content Area -->
            <div id="exd-content" class="exd-content-full">
                ${shimmerBlock(400)}
            </div>

            <!-- Modal -->
            <div id="exd-modal" class="exd-modal hidden">
                <div class="exd-modal-overlay" onclick="closeModal()"></div>
                <div class="exd-modal-content">
                    <div class="exd-modal-header">
                        <div>
                            <h3 id="exd-modal-title">View All</h3>
                            <div class="exd-modal-subtitle" id="exd-modal-subtitle"></div>
                        </div>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <button class="exd-modal-view-list-btn hidden" id="exd-modal-view-list-btn" title="Open full filtered list in ERPNext">
                                <span>Open in List View</span>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:4px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            </button>
                            <button class="exd-modal-close" onclick="closeModal()">×</button>
                        </div>
                    </div>
                    <div class="exd-modal-stats" id="exd-modal-stats"></div>
                    <div class="exd-modal-body" id="exd-modal-body">
                        <table class="exd-modal-table" id="exd-modal-table">
                            <thead></thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>

        </div>`;
    }

    function getCompanyOptions() {
        return `<option value="Jasma Engineering LLP" selected>Jasma Engineering LLP</option>`;
    }

    function loadFilterOptions() {
        frappe.call({
            method: methodRoot + "get_companies",
            callback: function (r) {
                if (r && r.message) {
                    state.companies = r.message;
                    let opts = '<option value="">All Companies</option>';
                    state.companies.forEach(c => {
                        const sel = c === (state.filters.company || "Jasma Engineering LLP") ? "selected" : "";
                        opts += `<option value="${c}" ${sel}>${c}</option>`;
                    });
                    $("#exd-company").html(opts);
                    if (state.filters.company) {
                        $("#exd-company").val(state.filters.company);
                    }
                }
            }
        });

        frappe.call({
            method: methodRoot + "get_customers",
            callback: function (r) {
                if (r && r.message) {
                    state.customers = r.message;
                    let opts = '<option value="">All Customers</option>';
                    state.customers.forEach(c => {
                        opts += `<option value="${c.value}">${c.label}</option>`;
                    });
                    $("#exd-customer").html(opts);
                }
            }
        });
    }

    function setupDatePickers() {
        const options = {
            language: "en",
            autoClose: true,
            todayButton: true,
            dateFormat: "dd-mm-yyyy",
            keyboardNav: false,
            firstDay: frappe.datetime.get_first_day_of_the_week_index
                ? frappe.datetime.get_first_day_of_the_week_index()
                : 0,
        };
        $("#exd-date-from").datepicker(options);
        $("#exd-date-to").datepicker(options);
    }

    function clearDatePicker(selector) {
        const instance = $(selector).data("datepicker");
        if (instance) {
            instance.clear();
        } else {
            $(selector).val("");
        }
    }

    function syncDateRangeInputs() {
        const dr = (state.data && state.data.date_range) || {};
        let fromDisplay = dr.from_date_fmt || dr.from_date || "";
        let toDisplay = dr.to_date_fmt || dr.to_date || "";

        if (fromDisplay) {
            $("#exd-display-from").text(fromDisplay);
            $("#exd-date-from").val(fromDisplay);
        }
        if (toDisplay) {
            $("#exd-display-to").text(toDisplay);
            $("#exd-date-to").val(toDisplay);
        }

        if (state.filters.period_preset === "custom") {
            $("#exd-inline-date-display").addClass("hidden");
            $("#exd-custom-range-bar").removeClass("hidden");
        } else {
            $("#exd-inline-date-display").removeClass("hidden");
            $("#exd-custom-range-bar").addClass("hidden");
        }
    }

    function ddmmyyyyToIso(value) {
        if (!value) return null;
        const parts = value.split("-");
        if (parts.length !== 3) return value;
        const [d, m, y] = parts;
        return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }

    function shimmerBlock(h) {
        return `<div class="exd-shimmer" style="height:${h || 180}px; border-radius:16px;"></div>`;
    }

    // ============================================================
    // DATA LOADING
    // ============================================================
    function loadPageData() {
        showLoading();

        frappe.call({
            method: methodRoot + "get_dashboard_data",
            args: {
                period_preset: state.filters.period_preset,
                company: state.filters.company,
                customer: state.filters.customer,
                status: state.filters.status,
                from_date: state.filters.from_date,
                to_date: state.filters.to_date,
            },
            callback: function (r) {
                if (r && r.message) {
                    state.data = r.message;
                    render();
                    syncDateRangeInputs();
                } else {
                    showError();
                }
            },
            error: function (err) {
                console.error("Employee Dashboard: Failed to load data", err);
                showError();
            }
        });
    }

    function showLoading() {
        $("#exd-content").html(`
            <div style="display:flex; flex-direction:column; gap:20px;">
                ${shimmerBlock(160)}
                ${shimmerBlock(140)}
                ${shimmerBlock(140)}
                ${shimmerBlock(240)}
            </div>
        `);
    }

    function showError() {
        $("#exd-content").html(`
            <div class="exd-error" style="text-align:center; padding:40px; background:var(--exd-surface); border:1px solid var(--exd-border); border-radius:16px;">
                <p style="font-size:16px; font-weight:600; color:var(--exd-text); margin-bottom:12px;">Failed to load dashboard data. Please try again.</p>
                <button class="exd-btn exd-btn-primary" onclick="location.reload()">Retry</button>
            </div>
        `);
    }

    // ============================================================
    // EVENTS
    // ============================================================
    function bindEvents() {
        $page.on("change", "#exd-company", function () {
            state.filters.company = $(this).val() || null;
            loadPageData();
        });

        $page.on("change", "#exd-customer", function () {
            state.filters.customer = $(this).val() || null;
            loadPageData();
        });

        $page.on("change", "#exd-period", function () {
            const preset = $(this).val();
            state.filters.period_preset = preset;

            if (preset === "custom") {
                $("#exd-inline-date-display").addClass("hidden");
                $("#exd-custom-range-bar").removeClass("hidden");
                clearDatePicker("#exd-date-from");
                clearDatePicker("#exd-date-to");
                return;
            }

            $("#exd-custom-range-bar").addClass("hidden");
            $("#exd-inline-date-display").removeClass("hidden");
            state.filters.from_date = null;
            state.filters.to_date = null;
            loadPageData();
        });

        $page.on("click", "#exd-apply-range", function () {
            const from_date_display = $("#exd-date-from").val();
            const to_date_display = $("#exd-date-to").val();
            if (from_date_display && to_date_display) {
                state.filters.period_preset = "custom";
                state.filters.from_date = ddmmyyyyToIso(from_date_display);
                state.filters.to_date = ddmmyyyyToIso(to_date_display);
                $("#exd-display-from").text(from_date_display);
                $("#exd-display-to").text(to_date_display);
                loadPageData();
            } else {
                frappe.msgprint("Please select both from and to dates.");
            }
        });

        $page.on("click", "#exd-cancel-range", function () {
            $("#exd-custom-range-bar").addClass("hidden");
            $("#exd-inline-date-display").removeClass("hidden");
            $("#exd-period").val("yearly");
            state.filters.period_preset = "yearly";
            state.filters.from_date = null;
            state.filters.to_date = null;
            loadPageData();
        });

        $page.on("click", "#exd-theme-toggle", toggleTheme);
        $page.on("click", "#exd-refresh", () => loadPageData());

        // Modal close
        window.closeModal = function () {
            $("#exd-modal").addClass("hidden");
        };

        // View All for Sales Order Pipeline cards -> Navigates to Sales Order List with all active filters
        $page.on("click", ".exd-card-view-all-btn", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const key = $(this).attr("data-key");
            openCardListView(key);
        });

        // Open in List View from Modal header
        $page.on("click", "#exd-modal-view-list-btn", function (e) {
            e.preventDefault();
            const key = $(this).attr("data-key") || state.currentModalKey;
            closeModal();
            openCardListView(key);
        });

        // Row click in drilldown modal -> opens individual Sales Order or document
        $page.on("click", ".exd-modal-row", function () {
            const name = $(this).attr("data-name");
            const doctype = $(this).attr("data-doctype") || "Sales Order";
            if (name) {
                frappe.set_route("Form", doctype, name);
            }
        });

        // View All BRC click -> Navigates to BRC Management List with filters applied
        $page.on("click", "#exd-view-all-ebrc", function (e) {
            e.preventDefault();
            const route_opts = {
                docstatus: 0,
            };
            if (state.filters.company) {
                route_opts["company"] = state.filters.company;
            }
            if (state.filters.customer) {
                route_opts["customer"] = state.filters.customer;
            }
            if (state.filters.from_date && state.filters.to_date) {
                route_opts["creation"] = ["between", [state.filters.from_date, state.filters.to_date]];
            }
            frappe.route_options = route_opts;
            frappe.set_route("List", "BRC Management", "List");
        });

        // Row click -> opens individual BRC Management document
        $page.on("click", ".exd-brc-row", function (e) {
            if ($(e.target).closest(".exd-icon-btn").length) return;
            const name = $(this).attr("data-name");
            if (name) {
                frappe.set_route("Form", "BRC Management", name);
            }
        });

        $page.on("click", ".is-clickable", function () {
            const key = $(this).attr("data-key");
            if (key) openModal(key);
        });
    }

    // ============================================================
    // LIST ROUTING WITH FILTERS (ERPNext Cycle Pipeline & Missing Info)
    // ============================================================
    function openCardListView(key) {
        const dr = (state.data && state.data.date_range) || {};
        const from_date = dr.from_date || state.filters.from_date;
        const to_date = dr.to_date || state.filters.to_date;

        const route_opts = {
            docstatus: 1,
        };

        if (state.filters.company) {
            route_opts["company"] = state.filters.company;
        }
        if (state.filters.customer) {
            route_opts["customer"] = state.filters.customer;
        }

        // Missing Info cards for Sales Invoice
        const missingFieldMap = {
            "pending_sb": "shipping_bill_number",
            "pending_bl": "bl_no",
            "pending_coo": "cerfticate_of_origin_no",
            "pending_insurance": "insurance_no",
            "pending_conformity": "conformity_certificate_no",
            "pending_bscectn": "bscectn_certificate_no",
        };

        if (missingFieldMap[key]) {
            if (from_date && to_date) {
                route_opts["posting_date"] = ["between", [from_date, to_date]];
            }
            route_opts[missingFieldMap[key]] = ["is", "not set"];
            frappe.route_options = route_opts;
            frappe.set_route("List", "Sales Invoice", "List");
            return;
        }

        // Financial & Compliance cards
        if (key === "pending_drawback") {
            if (from_date && to_date) {
                route_opts["posting_date"] = ["between", [from_date, to_date]];
            }
            route_opts["drawback_received"] = 0;
            frappe.route_options = route_opts;
            frappe.set_route("List", "Sales Invoice", "List");
            return;
        }

        if (key === "pending_igst") {
            if (from_date && to_date) {
                route_opts["posting_date"] = ["between", [from_date, to_date]];
            }
            route_opts["igst_received"] = 0;
            frappe.route_options = route_opts;
            frappe.set_route("List", "Sales Invoice", "List");
            return;
        }

        if (key === "rodtep_pending") {
            const je_opts = {
                voucher_type: "RODTEP Entry",
                docstatus: ["<", 2],
            };
            if (state.filters.company) {
                je_opts["company"] = state.filters.company;
            }
            if (from_date && to_date) {
                je_opts["posting_date"] = ["between", [from_date, to_date]];
            }
            frappe.route_options = je_opts;
            frappe.set_route("List", "Journal Entry", "List");
            return;
        }

        // Sales Order Pipeline cards
        if (from_date && to_date) {
            route_opts["transaction_date"] = ["between", [from_date, to_date]];
        }

        if (key === "so_to_mr_pending") {
            route_opts["status"] = ["in", ["To Deliver and Bill", "To Deliver"]];
        } else if (key === "so_to_dn_pending" || key === "delivery_note_pending") {
            route_opts["status"] = ["in", ["To Deliver and Bill", "To Deliver"]];
        } else if (key === "so_to_si_pending") {
            route_opts["status"] = ["in", ["To Deliver and Bill", "To Bill"]];
        }

        frappe.route_options = route_opts;
        frappe.set_route("List", "Sales Order");
    }

    // ============================================================
    // RENDER (Only Requested Cards, Bento Layout)
    // ============================================================
    function render() {
        const d = state.data;
        if (!d) return;

        const $c = $("#exd-content");

        $c.html(`
            <div class="exd-bento">

                <!-- 1. SALES ORDER PIPELINE (3 Cards in ERPNext Cycle Order) -->
                ${renderSalesOrderPipeline(d.sales_order_pipeline)}

                <!-- 2. SALES INVOICE - MISSING INFORMATION (Spans 12 Bento with 6 Cards) -->
                <div class="exd-bento-span-12 exd-card exd-anim" style="--delay:4;">
                    <div class="exd-card-label" style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
                        <span>${iconSvg("alert")} SALES INVOICE - MISSING INFORMATION</span>
                        <span style="color:var(--exd-text-3); cursor:pointer;" title="Documents awaiting required export & shipping details">${iconSvg("info", 14)}</span>
                    </div>
                    <div class="exd-missing-subgrid">
                        ${renderMissingInfoCards(d.missing_information)}
                    </div>
                </div>

                <!-- 3. FINANCIAL & COMPLIANCE PENDING (3 Cards, Spans 4 each) -->
                <div class="exd-bento-span-12" style="margin-top:4px;">
                    <div class="exd-card-label" style="margin-bottom:12px; font-size:13px;">
                        ${iconSvg("shield")} FINANCIAL & COMPLIANCE PENDING
                    </div>
                    <div class="exd-bento" style="gap:16px;">
                        ${renderFinancialCards(d.financial_compliance)}
                    </div>
                </div>

                <!-- 4. EBRC PENDING LIST (Full Spans 12 Bento Card with Clean Table) -->
                <div class="exd-bento-span-12 exd-card exd-anim" style="--delay:8;">
                    <div class="exd-card-label" style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
                        <span>${iconSvg("file")} EBRC PENDING LIST</span>
                        <a href="javascript:void(0)" id="exd-view-all-ebrc" class="exd-link" style="color:var(--exd-primary); font-weight:800; font-size:12.5px; letter-spacing:0.6px; text-decoration:none; text-transform:uppercase;">VIEW ALL</a>
                    </div>
                    <div class="exd-table-wrapper">
                        ${renderEbrcTable(d.ebrc_pending_list)}
                    </div>
                </div>

            </div>
        `);
    }

    // ============================================================
    // SECTION BUILDERS
    // ============================================================

    // --- 1. Sales Order Pipeline Cards in ERPNext Cycle Order (MR -> DN -> SI) ---
    function renderSalesOrderPipeline(sop) {
        const c_mr = (sop && sop.so_to_mr_pending) || {};
        const c_dn = (sop && sop.so_to_dn_pending) || {};
        const c_si = (sop && sop.so_to_si_pending) || {};

        const cards = [
            {
                key: "so_to_mr_pending",
                title: c_mr.title || "SO → MATERIAL RECEIPT (MR) PENDING",
                count: c_mr.count !== undefined ? c_mr.count : 19,
                badge: c_mr.badge || "Orders",
                badgeClass: c_mr.badge_class || "exd-badge-blue",
                subtext: c_mr.subtext || "Awaiting material availability",
                icon: "truck",
                circleClass: c_mr.circle_class || "exd-circle-blue",
                delay: 1,
                borderLeft: "#2563eb",
            },
            {
                key: "so_to_dn_pending",
                title: c_dn.title || "SO → DELIVERY NOTE PENDING",
                count: c_dn.count !== undefined ? c_dn.count : 19,
                badge: c_dn.badge || "Orders",
                badgeClass: c_dn.badge_class || "exd-badge-orange",
                subtext: c_dn.subtext || "Shipments awaiting notes",
                icon: "truck",
                circleClass: c_dn.circle_class || "exd-circle-orange",
                delay: 2,
                borderLeft: "#d97706",
            },
            {
                key: "so_to_si_pending",
                title: c_si.title || "SO → SALES INVOICE PENDING",
                count: c_si.count !== undefined ? c_si.count : 16,
                badge: c_si.badge || "Orders",
                badgeClass: c_si.badge_class || "exd-badge-orange",
                subtext: c_si.subtext || "25164949.18",
                icon: "receipt",
                circleClass: c_si.circle_class || "exd-circle-orange",
                delay: 3,
                borderLeft: "#ea580c",
            }
        ];

        return cards.map(c => `
            <div class="exd-bento-span-4 exd-card exd-card-blob exd-anim is-clickable" style="--delay:${c.delay}; border-left: 4px solid ${c.borderLeft};" data-key="${c.key}" title="Click to view details for ${c.title}">
                <div class="exd-card-header-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px;">
                    <div class="exd-card-label" style="margin-bottom:0; font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${c.title}">
                        ${c.title}
                    </div>
                    <button type="button" class="exd-card-view-all-btn" data-key="${c.key}" title="Open Sales Order list with filters for ${c.title}">
                        <span>VIEW ALL</span>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                            <span style="font-size:34px; font-weight:900; color:var(--exd-text); line-height:1;">${c.count}</span>
                            <span class="exd-badge-pill ${c.badgeClass}">${c.badge}</span>
                        </div>
                        <div style="font-size:13.5px; font-weight:700; color:var(--exd-text-2); line-height:1.2;">${c.subtext}</div>
                    </div>
                    <div class="exd-circle-icon ${c.circleClass}">
                        ${iconSvg(c.icon, 22)}
                    </div>
                </div>
            </div>
        `).join("");
    }

    // --- 2. Sales Invoice - Missing Information Subgrid (6 Cards in 3-3 Pair) ---
    function renderMissingInfoCards(missing) {
        if (!missing || !missing.length) return "";
        return missing.map((item, idx) => {
            const countVal = item.count !== undefined ? item.count : (item.value !== undefined ? item.value : 0);
            const color = item.color || "#ef4444";
            const sub = item.sub || item.subtext || "Missing No / Date";
            return `
                <div class="exd-missing-card is-clickable exd-anim" style="--delay:${idx + 2}; border-left: 4px solid ${color};" data-key="${item.key}" title="Click to view details for ${item.label}">
                    <div class="exd-missing-header-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px;">
                        <div class="exd-missing-label" style="margin-bottom:0; font-size:11.5px; font-weight:800; letter-spacing:0.5px; text-transform:uppercase; color:var(--exd-text-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${item.label}">
                            ${item.label}
                        </div>
                        <button type="button" class="exd-card-view-all-btn" data-key="${item.key}" title="Open Sales Invoice list with filters for ${item.label}">
                            <span>VIEW ALL</span>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
                        <div>
                            <div class="exd-missing-value" style="color:${color}; font-size:28px; font-weight:900; line-height:1; margin-bottom:4px;">
                                ${countVal}
                            </div>
                            <div class="exd-missing-sub" style="font-size:12px; font-weight:600; color:var(--exd-text-2);">
                                ${sub}
                            </div>
                        </div>
                        <div class="exd-badge-pill" style="background:${color}18; color:${color}; font-size:11px; font-weight:800; padding:4px 10px; border-radius:999px; text-transform:uppercase; letter-spacing:0.3px;">
                            Invoices
                        </div>
                    </div>
                </div>
            `;
        }).join("");
    }

    // --- 3. Financial & Compliance Cards (3 Cards, Spans 4 each) ---
    function renderFinancialCards(fc) {
        if (!fc) return "";
        const keys = ["pending_drawback", "pending_igst", "rodtep_pending"];
        return keys.map((k, idx) => {
            const c = fc[k];
            if (!c) return "";
            return `
                <div class="exd-bento-span-4 exd-card is-clickable exd-anim" style="--delay:${idx + 4}; border-left:4px solid ${c.color};" data-key="${k}" title="Click to view details for ${c.title}">
                    <div class="exd-card-header-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px;">
                        <div class="exd-card-label" style="margin-bottom:0; color:${c.color}; font-size:12px;">
                            ${iconSvg(c.icon || "shield", 14)} ${c.title}
                        </div>
                        <button type="button" class="exd-card-view-all-btn" data-key="${k}" title="Open Sales Invoice list with filters for ${c.title}">
                            <span>VIEW ALL</span>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:6px;">
                        <div>
                            <div style="font-size:28px; font-weight:900; color:var(--exd-text); line-height:1;">${c.count}</div>
                            <div style="font-size:11px; font-weight:600; color:var(--exd-text-3); margin-top:4px;">${c.count_label}</div>
                        </div>
                        ${c.value ? `
                            <div style="text-align:right;">
                                <div style="font-size:20px; font-weight:900; color:#10b981; line-height:1;">${c.value}</div>
                                <div style="font-size:11px; font-weight:700; color:var(--exd-text-3); text-transform:uppercase; margin-top:4px;">${c.value_label}</div>
                            </div>
                        ` : ""}
                    </div>
                </div>
            `;
        }).join("");
    }

    // --- 4. BRC Management Table (Draft Mode, No Status Column) ---
    function renderEbrcTable(rows) {
        if (!rows || !rows.length) {
            return `<div style="padding:28px; text-align:center; color:var(--exd-text-3); font-weight:600;">No draft BRC Management records found.</div>`;
        }

        let bodyRows = rows.map(r => {
            return `
                <tr class="exd-table-row exd-brc-row" data-name="${r.name}" style="cursor:pointer;" title="Click to open ${r.name}">
                    <td><strong style="color:var(--exd-primary); font-weight:700;">${r.name}</strong></td>
                    <td><strong style="color:var(--exd-text); font-weight:700;">${r.invoice_no}</strong></td>
                    <td style="color:var(--exd-text-2);">${r.date}</td>
                    <td style="color:var(--exd-text); font-weight:600;">${r.customer}</td>
                    <td style="color:var(--exd-text-3);">${r.currency}</td>
                    <td><strong style="color:var(--exd-text); font-weight:800;">${r.value}</strong></td>
                    <td style="text-align:right;">
                        <button class="exd-icon-btn exd-brc-action-btn" data-name="${r.name}" title="View ${r.name}" style="margin-left:auto;" onclick="event.stopPropagation(); frappe.set_route('Form', 'BRC Management', '${r.name}');">
                            ${iconSvg("eye", 15)}
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        return `
            <table class="exd-data-table">
                <thead>
                    <tr>
                        <th>BRC NO</th>
                        <th>INVOICE NO</th>
                        <th>DATE</th>
                        <th>CUSTOMER</th>
                        <th>CURRENCY</th>
                        <th>VALUE</th>
                        <th style="text-align:right;">ACTION</th>
                    </tr>
                </thead>
                <tbody>
                    ${bodyRows}
                </tbody>
            </table>
        `;
    }

    // ============================================================
    // MODAL DIALOG
    // ============================================================
    function openModal(cardKey) {
        state.currentModalKey = cardKey;
        $("#exd-modal").removeClass("hidden");
        $("#exd-modal-title").text("Loading Details...");
        $("#exd-modal-subtitle").text("Please wait");
        $("#exd-modal-view-list-btn").addClass("hidden");
        $("#exd-modal-table thead").empty();
        $("#exd-modal-table tbody").html(`<tr><td colspan="6" style="text-align:center; padding:30px;">${shimmerBlock(120)}</td></tr>`);

        frappe.call({
            method: methodRoot + "get_modal_drilldown",
            args: {
                card_key: cardKey,
                period_preset: state.filters.period_preset,
                company: state.filters.company,
                customer: state.filters.customer,
                status: state.filters.status,
                from_date: state.filters.from_date,
                to_date: state.filters.to_date,
            },
            callback: function (r) {
                if (r && r.message) {
                    const m = r.message;
                    $("#exd-modal-title").text(m.title || "Document Details");
                    $("#exd-modal-subtitle").text(m.subtitle || "");

                    if (m.card_key && (
                        m.card_key.startsWith("so_to_") || 
                        m.card_key.startsWith("pending_") || 
                        m.card_key.includes("delivery_note") || 
                        m.doctype === "Sales Order" || 
                        m.doctype === "Sales Invoice"
                    )) {
                        $("#exd-modal-view-list-btn").removeClass("hidden").attr("data-key", m.card_key);
                    } else {
                        $("#exd-modal-view-list-btn").addClass("hidden");
                    }

                    let head = "<tr>";
                    (m.columns || []).forEach(c => { head += `<th>${c}</th>`; });
                    head += "</tr>";
                    $("#exd-modal-table thead").html(head);

                    let body = "";
                    if (m.rows && m.rows.length) {
                        const doctype = m.doctype || (m.card_key && m.card_key.startsWith("so_") ? "Sales Order" : "Sales Invoice");
                        m.rows.forEach(row => {
                            const docname = row[0];
                            body += `<tr class="exd-table-row exd-modal-row" data-name="${docname}" data-doctype="${doctype}" style="cursor:pointer;" title="Click to open ${docname}">`;
                            row.forEach((cell, idx) => {
                                if (idx === 0) {
                                    body += `<td><strong style="color:var(--exd-primary);">${cell}</strong></td>`;
                                } else {
                                    body += `<td>${cell}</td>`;
                                }
                            });
                            body += "</tr>";
                        });
                    } else {
                        body = `<tr><td colspan="${m.columns.length || 6}" style="text-align:center; padding:24px;">No records found.</td></tr>`;
                    }
                    $("#exd-modal-table tbody").html(body);
                }
            }
        });
    }

    // ============================================================
    // SVG ICONS
    // ============================================================
    function iconSvg(name, size) {
        const I = {
            home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
            calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
            refresh: '<path d="M21 12a9 9 0 11-9-9c2.5 0 4.7 1 6.4 2.6L21 8M21 3v5h-5"/>',
            cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
            file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
            bank: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
            shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
            git: '<circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/>',
            box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
            truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
            chevron: '<polyline points="9 18 15 12 9 6"/>',
            sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
            moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
            users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
            alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
            receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M12 8h-2a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-2"/><path d="M10 7v1m0 8v1"/>',
            percent: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
            claim: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
            eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
            info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
        };
        const s = size || 15;
        return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;">${I[name] || ""}</svg>`;
    }

    // ============================================================
    // STYLES (Exact Executive Dashboard Design Language)
    // ============================================================
    function injectStyles() {
        if ($("#exd-style").length) return;

        $("head").append(`
<style id="exd-style">
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

.exd-page {
    --exd-bg: #f3f4f6;
    --exd-surface: #ffffff;
    --exd-border: #e5e7eb;
    --exd-text: #111827;
    --exd-text-2: #374151;
    --exd-text-3: #6b7280;
    --exd-primary: #6366f1;
    --exd-primary-dark: #4f46e5;
    --exd-primary-gradient: linear-gradient(135deg, #6366f1, #4f46e5);
    background: var(--exd-bg);
    font-family: 'Inter', -apple-system, sans-serif;
    padding: 0;
    margin: 0;
    min-height: 100vh;
    transition: background .2s ease;
    -webkit-font-smoothing: antialiased;
}
.exd-page * { box-sizing: border-box; }

.exd-page[data-theme="dark"] {
    --exd-bg: #14161f;
    --exd-surface: #1c1f2b;
    --exd-border: #2c2f3d;
    --exd-text: #f3f4f6;
    --exd-text-2: #cbd0dc;
    --exd-text-3: #8b8fa3;
}
.exd-page[data-theme="dark"] .exd-shimmer {
    background: linear-gradient(90deg,#1c1f2b 25%,#262a38 50%,#1c1f2b 75%);
    background-size: 200% 100%;
}
.exd-page[data-theme="dark"] .exd-card:hover { border-color: #3a3f52; }
.exd-page[data-theme="dark"] .exd-missing-card:hover { background: #262a45; }

.exd-shell {
    max-width: 100%;
    margin: 0;
    padding: 16px 24px 32px 24px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
}

/* Compact Filter Bar: All in One Row with Reduced Widths */
.exd-filter-bar {
    background: var(--exd-surface);
    border: 1px solid var(--exd-border);
    border-radius: 12px;
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    margin-bottom: 16px;
    flex-shrink: 0;
}
.exd-filter-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: nowrap;
    width: 100%;
}

.exd-field { position: relative; display: flex; align-items: center; flex-shrink: 0; }
.exd-field-icon svg { position: absolute; left: 14px; color: var(--exd-text-3); pointer-events: none; width: 16px; height: 16px; }
.exd-field select {
    border: 1px solid var(--exd-border);
    border-radius: 8px;
    padding: 8px 20px 8px 38px;
    font-size: 14px;
    font-weight: 600;
    color: var(--exd-text);
    background: var(--exd-bg);
    height: 40px;
    outline: none;
    appearance: none;
    cursor: pointer;
    transition: background .15s ease, border-color .15s ease;
}
.exd-field select:hover { background: var(--exd-surface); border-color: var(--exd-primary); }

#exd-company { min-width: 175px; width: auto; }
#exd-customer { min-width: 185px; max-width: 260px; width: auto; }
#exd-period { min-width: 195px; width: auto; }

/* Inline Generous Active Date Display on Same Line */
.exd-inline-date-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--exd-bg);
    border: 1px solid var(--exd-border);
    border-radius: 8px;
    height: 40px;
    padding: 0 18px;
    font-size: 14px;
    font-weight: 600;
    color: var(--exd-text);
    white-space: nowrap;
    flex-shrink: 0;
}
.exd-inline-date-pill .to-sep {
    color: var(--exd-text-3);
    font-weight: 500;
}

.exd-filter-right { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.exd-icon-btn {
    width: 36px; height: 36px;
    border-radius: 8px;
    border: 1px solid var(--exd-border);
    background: var(--exd-surface);
    color: var(--exd-text-2);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all .2s;
}
.exd-icon-btn:hover { background: var(--exd-bg); border-color: var(--exd-primary); color: var(--exd-primary); }
.exd-btn {
    border-radius: 8px;
    font-weight: 700;
    border: none;
    cursor: pointer;
    transition: all .2s;
}

/* Custom Range Row: Displayed Below */
.exd-custom-range-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-top: 10px;
    border-top: 1px dashed var(--exd-border);
}
.exd-custom-range-bar.hidden {
    display: none !important;
}
.exd-custom-range-bar .to-sep {
    font-size: 13.5px;
    color: var(--exd-text-3);
    font-weight: 600;
}
.exd-date-input {
    border: 1px solid var(--exd-border);
    border-radius: 8px;
    padding: 8px 18px 8px 38px;
    font-size: 14px;
    font-weight: 600;
    color: var(--exd-text);
    background: var(--exd-bg);
    height: 40px;
    width: 175px;
    outline: none;
    cursor: pointer;
    transition: background .15s ease, border-color .15s ease;
}
.exd-date-input:hover, .exd-date-input:focus {
    background: var(--exd-surface);
    border-color: var(--exd-primary);
}

#exd-apply-range {
    height: 40px;
    padding: 0 20px;
    font-size: 14px;
    font-weight: 700;
    border-radius: 8px;
    background: var(--exd-primary);
    color: #ffffff;
    border: none;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(99,102,241,0.25);
    transition: all .2s;
}
#exd-apply-range:hover {
    background: var(--exd-primary-dark);
}

#exd-cancel-range {
    height: 40px;
    padding: 0 18px;
    font-size: 14px;
    font-weight: 600;
    border-radius: 8px;
    background: var(--exd-bg);
    border: 1px solid var(--exd-border);
    color: var(--exd-text-2);
    cursor: pointer;
    transition: all .2s;
}
#exd-cancel-range:hover {
    background: var(--exd-surface);
    color: var(--exd-text);
}

/* Bento Grid System */
.exd-bento {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 20px;
}
.exd-bento-span-3 { grid-column: span 3; }
.exd-bento-span-4 { grid-column: span 4; }
.exd-bento-span-6 { grid-column: span 6; }
.exd-bento-span-12 { grid-column: span 12; }

/* Animations */
.exd-anim {
    opacity: 0;
    animation: exd-slide-up .4s cubic-bezier(.16,1,.3,1) forwards;
    animation-delay: calc(var(--delay, 0) * 0.04s);
}
@keyframes exd-slide-up {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

/* Cards */
.exd-card {
    position: relative;
    background: var(--exd-surface);
    border-radius: 16px;
    padding: 20px 24px;
    border: 1px solid var(--exd-border);
    box-shadow: 0 1px 2px rgba(16,24,40,0.04), 0 4px 12px -4px rgba(16,24,40,0.06);
    overflow: hidden;
    transition: transform .25s cubic-bezier(.16,1,.3,1), box-shadow .25s ease, border-color .25s ease;
}
.exd-card.is-clickable { cursor: pointer; }
.exd-card.is-clickable:hover {
    transform: translateY(-2px);
    box-shadow: 0 2px 4px rgba(16,24,40,0.05), 0 12px 24px -8px rgba(16,24,40,0.12);
    border-color: #dfe3ea;
}
.exd-card-blob::before {
    content: "";
    position: absolute;
    top: -70px;
    right: -70px;
    width: 180px;
    height: 180px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(99,102,241,0.10), rgba(99,102,241,0) 70%);
    pointer-events: none;
    z-index: 0;
}
.exd-card > * { position: relative; z-index: 1; }
.exd-card-label {
    font-size: 12px;
    font-weight: 800;
    color: var(--exd-text-3);
    letter-spacing: 0.7px;
    text-transform: uppercase;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
}
.exd-card-label svg { width: 14px; height: 14px; color: var(--exd-primary); flex-shrink: 0; }

/* Badges & Icons */
.exd-badge-pill {
    font-size: 12px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 6px;
}
.exd-badge-orange { background: #ffedd5; color: #ea580c; }
.exd-badge-blue { background: #dbeafe; color: #2563eb; }

.exd-circle-icon {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.exd-circle-orange { background: #ffedd5; color: #ea580c; }
.exd-circle-blue { background: #dbeafe; color: #2563eb; }

/* Missing Info Subgrid (3-3 Pair: Upper 3, Lower 3) */
.exd-missing-subgrid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
}
.exd-missing-card {
    background: var(--exd-bg);
    border: 1px solid var(--exd-border);
    border-radius: 12px;
    padding: 16px 18px;
    text-align: left;
    transition: transform .15s ease, border-color .15s ease, background .15s ease, box-shadow .15s ease;
    cursor: pointer;
}
.exd-missing-card:hover {
    transform: translateY(-2px);
    border-color: var(--exd-primary);
    background: var(--exd-surface);
    box-shadow: 0 4px 14px rgba(0,0,0,0.06);
}
.exd-missing-label {
    font-size: 11.5px;
    font-weight: 800;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--exd-text-3);
    margin-bottom: 6px;
}
.exd-missing-value {
    font-size: 28px;
    font-weight: 900;
    line-height: 1;
    margin-bottom: 4px;
}
.exd-missing-sub {
    font-size: 12px;
    font-weight: 600;
    color: var(--exd-text-2);
}

/* Clean Data Table */
.exd-table-wrapper { overflow-x: auto; }
.exd-data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
}
.exd-data-table th {
    text-align: left;
    padding: 12px 14px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.6px;
    color: var(--exd-text-3);
    text-transform: uppercase;
    border-bottom: 1px solid var(--exd-border);
}
.exd-data-table td {
    padding: 14px;
    border-bottom: 1px solid var(--exd-border);
    color: var(--exd-text);
}
.exd-table-row:hover {
    background: rgba(0,0,0,0.015);
}
.exd-page[data-theme="dark"] .exd-table-row:hover {
    background: rgba(255,255,255,0.03);
}

/* Modal Window */
.exd-modal {
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: 1050;
    display: flex;
    align-items: center;
    justify-content: center;
}
.exd-modal.hidden { display: none; }
.exd-modal-overlay {
    position: absolute;
    width: 100%; height: 100%;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(4px);
}
.exd-modal-content {
    position: relative;
    background: var(--exd-surface);
    border-radius: 20px;
    width: 90%;
    max-width: 920px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
    border: 1px solid var(--exd-border);
    overflow: hidden;
    animation: exd-slide-up .2s ease-out;
}
.exd-modal-header {
    padding: 20px 28px;
    border-bottom: 1px solid var(--exd-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.exd-modal-header h3 { margin: 0; font-size: 18px; font-weight: 800; color: var(--exd-text); }
.exd-modal-subtitle { font-size: 12px; color: var(--exd-text-3); margin-top: 2px; }
.exd-modal-close {
    background: none; border: none; font-size: 26px; color: var(--exd-text-3); cursor: pointer;
}
.exd-modal-close:hover { color: var(--exd-text); }
.exd-modal-body { padding: 20px 28px; overflow-y: auto; flex: 1; }
.exd-modal-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.exd-modal-table th {
    text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 800;
    color: var(--exd-text-3); text-transform: uppercase; border-bottom: 1px solid var(--exd-border);
}
.exd-modal-table td { padding: 12px 14px; border-bottom: 1px solid var(--exd-border); color: var(--exd-text); }

/* Shimmer */
.exd-shimmer {
    background: linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%);
    background-size: 200% 100%;
    animation: exd-shimmer-anim 1.5s infinite;
}
@keyframes exd-shimmer-anim {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

/* Card View All Button */
.exd-card-view-all-btn {
    background: var(--exd-bg);
    border: 1px solid var(--exd-border);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 10px;
    font-weight: 800;
    color: var(--exd-primary);
    letter-spacing: 0.5px;
    text-transform: uppercase;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    transition: all .15s ease;
    line-height: 1.4;
    flex-shrink: 0;
}
.exd-card-view-all-btn:hover {
    background: var(--exd-primary);
    color: #ffffff;
    border-color: var(--exd-primary);
    box-shadow: 0 2px 6px rgba(99,102,241,0.25);
    transform: translateY(-1px);
}
.exd-page[data-theme="dark"] .exd-card-view-all-btn {
    background: #25293a;
    border-color: #35394d;
    color: #818cf8;
}
.exd-page[data-theme="dark"] .exd-card-view-all-btn:hover {
    background: var(--exd-primary);
    color: #ffffff;
    border-color: var(--exd-primary);
}

/* Modal View List Button */
.exd-modal-view-list-btn {
    background: var(--exd-bg);
    border: 1px solid var(--exd-border);
    border-radius: 8px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 700;
    color: var(--exd-primary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    transition: all .2s ease;
}
.exd-modal-view-list-btn:hover {
    background: var(--exd-primary);
    color: #ffffff;
    border-color: var(--exd-primary);
}
.exd-modal-view-list-btn.hidden {
    display: none !important;
}

.exd-modal-row:hover {
    background: rgba(99,102,241,0.05) !important;
}
.exd-page[data-theme="dark"] .exd-modal-row:hover {
    background: rgba(99,102,241,0.12) !important;
}

/* Responsive */
@media (max-width: 1024px) {
    .exd-filter-row { flex-wrap: wrap; }
    .exd-missing-subgrid { grid-template-columns: repeat(3, 1fr); }
    .exd-bento-span-4 { grid-column: span 6; }
    .exd-bento-span-3 { grid-column: span 6; }
}
@media (max-width: 768px) {
    .exd-filter-row { flex-wrap: wrap; }
    .exd-field select { width: 100%; }
    .exd-missing-subgrid { grid-template-columns: repeat(2, 1fr); }
    .exd-bento-span-6 { grid-column: span 12; }
    .exd-bento-span-4 { grid-column: span 12; }
    .exd-bento-span-3 { grid-column: span 12; }
}
@media (max-width: 540px) {
    .exd-missing-subgrid { grid-template-columns: 1fr; }
}
</style>
        `);
    }
};