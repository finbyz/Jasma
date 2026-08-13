// jasma/jasma/page/executive_dashboard/executive_dashboard.js

frappe.pages["executive-dashboard"].on_page_load = function (wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Executive Dashboard"),
        single_column: true,
    });

    const methodRoot = "jasma.jasma.page.executive_dashboard.executive_dashboard.";

    const state = {
        filters: {
            period_preset: "yearly",
            company: null,
            from_date: null,
            to_date: null,
        },
        data: null,
        theme: localStorage.getItem("exd_theme") || "light",
        stockSort: "qty",
        sellingSort: "qty",
        purchaseSort: "qty",
        itemGroups: [],
        itemGroupsLoaded: false,
        cardItemGroupFilters: {
            stockItems: [],
            topSelling: [],
            topPurchase: [],
        },
    };

    const $page = $(wrapper).find(".page-content");
    // Remove padding from page content
    $page.css("padding", "0");
    injectStyles();
    $page.addClass("exd-page").html(getLayout());
    applyTheme();

    bindEvents();
    setupDatePickers();
    loadItemGroups();
    loadPageData();

    // ============================================================
    // THEME
    // ============================================================
    function applyTheme() {
        $page.attr("data-theme", state.theme);
        $("#exd-theme-toggle").html(iconSvg(state.theme === "dark" ? "sun" : "moon"));
        $("#exd-theme-toggle").attr("title", state.theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode");
        // The date-picker popup is appended to <body>, outside .exd-page, so
        // it only follows Frappe's own site-wide theme setting by default -
        // not this dashboard's own light/dark toggle. Mirror our toggle onto
        // <body> via a dedicated class so the calendar popup can match it.
        $("body").toggleClass("exd-calendar-dark", state.theme === "dark");
    }

    function toggleTheme() {
        state.theme = state.theme === "dark" ? "light" : "dark";
        localStorage.setItem("exd_theme", state.theme);
        applyTheme();
    }

    // ============================================================
    // LAYOUT
    // ============================================================
    function getLayout() {
        return `
        <div class="exd-shell">

            <div class="exd-filter-bar">
                <div class="exd-field exd-field-icon">
                    ${iconSvg("home")}
                    <select id="exd-company">
                        <option value="">All Companies</option>
                        ${getCompanyOptions()}
                    </select>
                </div>
                <div class="exd-field exd-field-icon">
                    ${iconSvg("calendar")}
                    <select id="exd-period">
                        <option value="yearly" selected>This Financial Year</option>
                        <option value="previous_fy">Previous Financial Year</option>
                        <option value="quarterly">Quarterly (Last 3 Months)</option>
                        <option value="monthly">Monthly</option>
                        <option value="weekly">Weekly</option>
                        <option value="custom">Custom Range</option>
                    </select>
                </div>
                <div id="exd-custom-range" class="exd-custom-range">
                    <input type="text" id="exd-date-from" class="exd-date-input" title="From Date" placeholder="DD-MM-YYYY" autocomplete="off" readonly disabled>
                    <span>to</span>
                    <input type="text" id="exd-date-to" class="exd-date-input" title="To Date" placeholder="DD-MM-YYYY" autocomplete="off" readonly disabled>
                    <button class="exd-btn exd-btn-primary hidden" id="exd-apply-range">Apply</button>
                </div>
                <div class="exd-filter-right">
                    <button class="exd-icon-btn" id="exd-theme-toggle" title="Switch to Dark Mode">${iconSvg("moon")}</button>
                    <button class="exd-icon-btn" id="exd-refresh" title="Refresh">${iconSvg("refresh")}</button>
                </div>
            </div>

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
                        <button class="exd-modal-close" onclick="closeModal()">×</button>
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
        let options = "";
        try {
            const companies = frappe.get_list("Company", { fields: ["name"] });
            companies.forEach(c => {
                options += `<option value="${c.name}">${c.name}</option>`;
            });
        } catch (e) {
            options = `
                <option value="Jasma HQ">Jasma (HQ)</option>
                <option value="Jasma Global">Jasma (Global)</option>
                <option value="Jasma EU">Jasma (EU)</option>
            `;
        }
        return options;
    }

    async function loadItemGroups() {
        try {
            const r = await frappe.call({
                method: methodRoot + "get_stock_item_groups",
            });
            const groups = (r && r.message) || [];
            // get_stock_item_groups() returns rows shaped {item_group: "..."},
            // but the rest of this file (getItemGroupOptions, etc.) expects
            // {name: "..."} - normalize here rather than touching every
            // downstream usage.
            state.itemGroups = groups.map(g => ({ name: g.item_group }));
        } catch (e) {
            console.warn("Executive Dashboard: failed to load Item Groups", e);
            state.itemGroups = [];
        } finally {
            state.itemGroupsLoaded = true;
            updateItemGroupSelectOptions();
        }
    }

    function updateItemGroupSelectOptions() {
        $(".exd-card-item-group-select").each(function () {
            const key = this.id.replace("exd-card-item-group-", "");
            const selectedGroup = (state.cardItemGroupFilters[key] || [])[0] || "";
            $(this).html(getItemGroupOptions(selectedGroup));
        });
    }

    function shimmerBlock(h) {
        return `<div class="exd-shimmer" style="height:${h || 180}px; border-radius:16px;"></div>`;
    }

    // ============================================================
    // EVENTS
    // ============================================================
    function bindEvents() {
        $page.on("change", "#exd-company", function () {
            state.filters.company = $(this).val() || null;
            loadPageData();
        });

        $page.on("change", "#exd-period", function () {
            const preset = $(this).val();
            state.filters.period_preset = preset;

            if (preset === "custom") {
                // Unlock the date pickers and wait for the user to pick a
                // range and hit Apply - don't reload with an empty range.
                $("#exd-date-from, #exd-date-to").prop("disabled", false).prop("readonly", false);
                $("#exd-apply-range").removeClass("hidden");
                clearDatePicker("#exd-date-from");
                clearDatePicker("#exd-date-to");
                return;
            }

            // Picking a quick preset locks the date pickers again (they'll
            // be filled in read-only with whatever dates the preset
            // resolves to once the data comes back) and clears any explicit
            // date-range override.
            $("#exd-date-from, #exd-date-to").prop("disabled", true).prop("readonly", true);
            $("#exd-apply-range").addClass("hidden");
            state.filters.from_date = null;
            state.filters.to_date = null;
            loadPageData();
        });

        $page.on("click", "#exd-apply-range", function () {
            const from_date = $("#exd-date-from").val();
            const to_date = $("#exd-date-to").val();
            if (from_date && to_date) {
                state.filters.period_preset = "custom";
                state.filters.from_date = from_date;
                state.filters.to_date = to_date;
                loadPageData();
            } else {
                frappe.msgprint("Please select both from and to dates.");
            }
        });

        $page.on("click", "#exd-refresh", () => loadPageData());
        $page.on("click", "#exd-theme-toggle", () => toggleTheme());

        $page.on("change", ".exd-card-item-group-select", function () {
            const key = this.id.replace("exd-card-item-group-", "");
            const selected = $(this).val();
            state.cardItemGroupFilters[key] = selected ? [selected] : [];
            refreshLeaderboardCard(key);
        });

        $(document).on("keydown", function (e) {
            if (e.key === "Escape") closeModal();
        });

        $page.on("click", ".exd-modal-row-clickable", function () {
            const so = $(this).data("so");
            const mr = $(this).data("mr");
            const po = $(this).data("po");
            if (so) {
                closeModal();
                frappe.set_route("Form", "Sales Order", so);
            } else if (mr) {
                closeModal();
                frappe.set_route("Form", "Material Request", mr);
            } else if (po) {
                closeModal();
                frappe.set_route("Form", "Purchase Order", po);
            }
        });

        window.openModal = openModal;
        window.closeModal = closeModal;
        window.openPendingMRModal = openPendingMRModal;
        window.openPendingPOModal = openPendingPOModal;
        window.openReceiptPendingModal = openReceiptPendingModal;
        window.openPendingDeliveryModal = openPendingDeliveryModal;
        window.openTreasuryLedger = openTreasuryLedger;
        window.openReceivablesReport = openReceivablesReport;
        window.openSalesInvoiceList = openSalesInvoiceList;
        window.openSalesOrderList = openSalesOrderList;
        window.openQuotationList = openQuotationList;
        window.openAgingPayablesReport = openAgingPayablesReport;
        window.openMonthlyRevenueReport = openMonthlyRevenueReport;
        window.openMonthlySalesOrderTrend = openMonthlySalesOrderTrend;
        window.openTaxClaimsReport = openTaxClaimsReport;
        window.openDelayedSalesOrderList = openDelayedSalesOrderList;
        window.switchLeaderboardSort = switchLeaderboardSort;
    }

    // Use Frappe's own calendar widget (the same one every date field in the
    // desk uses) instead of the plain browser-native date popup - same
    // polish as the rest of the app, and it already reads YYYY-MM-DD in/out
    // when dateFormat is set to that, so nothing else here needs to change.
    function setupDatePickers() {
        const options = {
            language: "en",
            autoClose: true,
            todayButton: true,
            dateFormat: "dd-mm-yyyy",  // Changed from "yyyy-mm-dd" to "dd-mm-yyyy"
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

    // ============================================================
    // DATA LOADING
    // ============================================================
    function loadPageData() {
        showLoading();

        frappe.call({
            method: methodRoot + "get_page_data",
            args: {
                period_preset: state.filters.period_preset,
                company: state.filters.company,
                from_date: state.filters.from_date,
                to_date: state.filters.to_date,
            },
            callback: function (r) {
                if (r && r.message) {
                    state.data = r.message;
                    render();
                    syncDateRangeInputs();
                    // get_page_data() always computes stockItems/topSelling/
                    // topPurchase WITHOUT any Item Group filter (it has no
                    // way to know which cards had one selected). Re-fetch
                    // those specific cards right after so a previously
                    // chosen filter keeps applying instead of silently
                    // reverting to the unfiltered top 5 on every period/
                    // company change or refresh.
                    reapplyCardItemGroupFilters();
                }
            },
            error: function (err) {
                console.error("Executive Dashboard: Failed to load data", err);
                showError();
            }
        });
    }

    function syncDateRangeInputs() {
        // For quick presets (everything except Custom Range) the date
        // inputs are read-only - keep them in sync with whatever dates the
        // preset actually resolved to server-side, so the user can see the
        // range being applied without being able to edit it.
        if (state.filters.period_preset === "custom") return;
        const ts = (state.data && state.data.total_sales) || {};
        if (ts.from_date) {
            // Convert YYYY-MM-DD to DD-MM-YYYY for display
            const fromDate = ts.from_date.split('-');
            if (fromDate.length === 3) {
                $("#exd-date-from").val(`${fromDate[2]}-${fromDate[1]}-${fromDate[0]}`);
            } else {
                $("#exd-date-from").val(ts.from_date);
            }
        }
        if (ts.to_date) {
            // Convert YYYY-MM-DD to DD-MM-YYYY for display
            const toDate = ts.to_date.split('-');
            if (toDate.length === 3) {
                $("#exd-date-to").val(`${toDate[2]}-${toDate[1]}-${toDate[0]}`);
            } else {
                $("#exd-date-to").val(ts.to_date);
            }
        }
    }

    function showLoading() {
        $("#exd-content").html(shimmerBlock(400));
    }

    function showError() {
        $("#exd-content").html(`
            <div class="exd-error">
                <p>Failed to load dashboard data. Please try again.</p>
                <button class="exd-btn exd-btn-primary" onclick="location.reload()">Retry</button>
            </div>
        `);
    }

    // ============================================================
    // RENDER
    // ============================================================
    function render() {
        const d = state.data;
        if (!d) return;

        const $c = $("#exd-content");

        const getVal = (obj, key, fallback = "N/A") => {
            return obj && obj[key] !== undefined && obj[key] !== null ? obj[key] : fallback;
        };

        $c.html(`
            <div class="exd-bento">

                <!-- TOTAL SALES - Spans 6 -->
                <div class="exd-bento-span-6 exd-card exd-card-sales exd-card-blob exd-anim" style="--delay:1;">
                    <div class="exd-card-sales-dual">
                        <div class="exd-card-sales-half">
                            <div class="exd-card-label">${iconSvg("cart")} TOTAL SALES</div>
                            <div class="exd-card-value-large is-clickable" style="cursor:pointer; display:inline-block;" onclick="openSalesInvoiceList()" title="Click to view Sales Invoices">${getVal(d.total_sales, "net_total_fmt", "₹ 0")}</div>
                        </div>
                        <div class="exd-card-sales-half">
                            <div class="exd-card-label">${iconSvg("box")} TOTAL ORDER</div>
                            <div class="exd-card-value-large is-clickable" style="cursor:pointer; display:inline-block;" onclick="openSalesOrderList()" title="Click to view Sales Orders">${getVal(d.total_sales_order, "net_total_fmt", "₹ 0")}</div>
                        </div>
                    </div>
                    <!-- Profit line removed as requested -->
                    <div class="exd-card-stats">
                        <div class="is-clickable" style="cursor:pointer;" onclick="openSalesOrderList()" title="Click to view Sales Orders">
                            <span class="exd-stat-label">ORDERS</span>
                            <span class="exd-stat-value">${getVal(d.sales_orders, "count", 0)}</span>
                        </div>
                        <div class="is-clickable" style="cursor:pointer;" onclick="openSalesOrderList('Completed')" title="Click to view Completed Sales Orders">
                            <span class="exd-stat-label">${iconSvg("check", 12)} COMPLETED</span>
                            <span class="exd-stat-value exd-text-green">${getVal(d.sales_orders, "completed", 0)}</span>
                        </div>
                        <div class="is-clickable" style="cursor:pointer;" onclick="openSalesOrderList(null, true)" title="Click to view Pending Sales Orders">
                            <span class="exd-stat-label">${iconSvg("clock", 12)} PENDING</span>
                            <span class="exd-stat-value exd-text-yellow">${getVal(d.sales_orders, "pending", 0)}</span>
                        </div>
                    </div>
                    ${renderMiniOrderBar(d.sales_orders)}
                </div>

                <!-- QUOTATIONS - Spans 3 -->
                <div class="exd-bento-span-3 exd-card exd-card-quotations exd-card-blob exd-anim" style="--delay:2;">
                    <div class="exd-card-label">${iconSvg("file")} QUOTATIONS</div>
                    <div class="exd-quotation-total is-clickable" style="cursor:pointer;" onclick="openQuotationList()" title="Click to view Quotations">
                        <span class="exd-stat-label">TOTAL (${getVal(d.quotations, "total_count", 0)})</span>
                        <div class="exd-card-value" style="font-size:31px;">${getVal(d.quotations, "total_value_fmt", "₹ 0")}</div>
                    </div>
                    <div class="exd-quotation-stats">
                        <div class="is-clickable" style="cursor:pointer;" onclick="openQuotationList('Lost')" title="Click to view Lost Quotations">
                            <span class="exd-stat-label">LOST (${getVal(d.quotations, "lost_count", 0)})</span>
                            <span class="exd-stat-value exd-text-red">${getVal(d.quotations, "lost_value_fmt", "₹ 0")}</span>
                        </div>
                        <div class="is-clickable" style="cursor:pointer;" onclick="openQuotationList('Expired')" title="Click to view Expired Quotations">
                            <span class="exd-stat-label">EXPIRED (${getVal(d.quotations, "expired_count", 0)})</span>
                            <span class="exd-stat-value exd-text-yellow">${getVal(d.quotations, "expired_value_fmt", "₹ 0")}</span>
                        </div>
                    </div>
                </div>

                <!-- CONVERSION + CURRENCY - Spans 3 (Stacked) -->
                <div class="exd-bento-span-3" style="display:flex;flex-direction:column;gap:16px;">
                    <!-- Conversion Ratio - WITH GRADIENT -->
                    <div class="exd-card exd-card-conversion exd-card-primary-gradient exd-anim" style="--delay:3;">
                        <div class="exd-card-label" style="color:rgba(255,255,255,0.8);">CONVERSION RATIO</div>
                        <div class="exd-conversion-main">
                            <span class="exd-conversion-value" style="color:#fff;">${getVal(d.conversion_ratio, "percentage", 0)}%</span>
                            <span class="exd-conversion-trend" style="color:${getVal(d.conversion_ratio, "trend_up", true) ? "#A7F3D0" : "#FCA5A5"};">${getVal(d.conversion_ratio, "trend", "+0%")}</span>
                        </div>
                        <div class="exd-conversion-sub" style="color:rgba(255,255,255,0.7);">Orders vs Quotations</div>
                    </div>

                    <!-- Currency Averages -->
                    <div class="exd-card exd-card-currency exd-anim" style="--delay:4;">
                        <div class="exd-card-label">${iconSvg("globe")} CURRENCY AVG. RATES</div>
                        <div class="exd-currency-grid">
                            ${renderCurrencyAverages(d.currency_averages)}
                        </div>
                    </div>
                </div>

                <!-- Fulfillment Pipeline (Spans 12) -->
                <div class="exd-bento-span-12 exd-card exd-anim" style="--delay:5;">
                    <div class="exd-card-label" style="margin-bottom:16px;">${iconSvg("git")} FULFILLMENT PIPELINE</div>
                    <div class="exd-pipeline">
                        ${getPipelineStages(d.pipeline)}
                    </div>
                </div>

                <!-- TREASURY + RECEIVABLES (Wider, share row) -->
                <div class="exd-bento-span-6 exd-card exd-anim" style="--delay:6;">
                    <div class="exd-card-label">${iconSvg("bank")} TREASURY BALANCES</div>
                    <div style="margin-top:12px;">
                        <div class="exd-kv-row is-clickable" onclick="openTreasuryLedger()" title="Click to view General Ledger">
                            <span>Total ${getVal(d.treasury, "base_currency", "INR")} Base</span><b>${getVal(d.treasury, "base_total_fmt", "₹ 0")}</b>
                        </div>
                        <div class="exd-currency-grid" style="margin-top:8px;">
                            ${renderCurrencyBalances(d.treasury)}
                        </div>
                    </div>
                </div>

                <div class="exd-bento-span-6 exd-card exd-anim" style="--delay:7;">
                    <div class="exd-card-label">${iconSvg("download")} RECEIVABLES</div>
                    <div style="margin-top:12px;">
                        <div class="exd-kv-row exd-kv-warn is-clickable" onclick="openReceivablesReport()" title="Click to view Accounts Receivable" style="margin-bottom:8px;">
                            <span>Pending (${getVal(d.receivables, "base_currency", "INR")})</span><b>${getVal(d.receivables, "base_total_fmt", "₹ 0")}</b>
                        </div>
                        <div class="exd-currency-grid">
                            ${renderCurrencyBalances(d.receivables)}
                        </div>
                    </div>
                </div>
                    <!-- Monthly Revenue Trend + Tax Claims (side-by-side) -->
                    <div class="exd-bento-span-7 exd-card exd-anim is-clickable" style="--delay:9; cursor:pointer;" onclick="openMonthlyRevenueReport()" title="Click to view Sales Analytics report">
                        <div class="exd-card-label">${iconSvg("bar")} MONTHLY REVENUE TREND (SALES INVOICE)</div>
                        <div class="exd-chart-container" style="height:180px;">
                            ${renderMonthlyChart(d.monthly_revenue)}
                        </div>
                    </div>

                    <div class="exd-bento-span-5 exd-card exd-anim" style="--delay:9;">
                        <div class="exd-card-label">${iconSvg("shield")} TAX CLAIMS</div>
                        <div style="margin-top:14px; display:flex; flex-direction:column; gap:16px;">
                            ${renderTaxClaims(d.tax_claims)}
                        </div>
                    </div>

                    <!-- Sales Order Trend beside Aging Payables -->
                    <div class="exd-bento-span-7 exd-card exd-anim is-clickable" style="--delay:10; cursor:pointer;" onclick="openMonthlySalesOrderTrend()" title="Click to view Sales Orders filtered by Sales Order dates">
                        <div class="exd-card-label">${iconSvg("bar")} MONTHLY REVENUE TREND (SALES ORDER)</div>
                        <div class="exd-chart-container" style="height:180px;">
                            ${renderMonthlyChart(d.monthly_sales_order)}
                        </div>
                    </div>

                    <div class="exd-bento-span-5 exd-card exd-anim is-clickable" style="--delay:11; cursor:pointer;" onclick="openAgingPayablesReport()" title="Click to view Accounts Payable Summary report">
                        <div class="exd-card-label">${iconSvg("bar")} AGING PAYABLES</div>
                        <div class="exd-chart-container" style="height:180px;">
                            ${renderAgingChart(d.aging_payables)}
                        </div>
                    </div>

                <!-- Leaderboards Section -->
                ${renderLeaderboards(d.leaderboards)}

            </div>
        `);

        addTooltips();
    }

    // ============================================================
    // RENDER HELPERS
    // ============================================================

    function getPipelineStages(pipeline) {
        if (!pipeline) return '<div class="exd-pipeline-stage">No data</div>';

        const stages = [
            { key: "pending_mr_for_so", label: "PENDING MR", sub: "FOR SALES ORDER", icon: "file", color: "#3b82f6", bg: "#eff6ff", clickable: true, onclick: "openPendingMRModal()", title: "Click to view Sales Orders" },
            { key: "pending_po", label: "PENDING PO", sub: "MR SUBMITTED", icon: "cart", color: "#d97706", bg: "#fffbeb", clickable: true, onclick: "openPendingPOModal()", title: "Click to view Material Requests" },
            { key: "receipt_pending", label: "RECEIPT PENDING", sub: "ORDERED, NOT RECEIVED", icon: "box", color: "#7c3aed", bg: "#f5f3ff", clickable: true, onclick: "openReceiptPendingModal()", title: "Click to view Purchase Orders" },
            { key: "pending_delivery", label: "PENDING", sub: "TO DELIVERY", icon: "truck", color: "#10b981", bg: "#ecfdf5", clickable: true, onclick: "openPendingDeliveryModal()", title: "Click to view Sales Orders" },
        ];

        return stages.map((s, i) => {
            const stage = `
            <div class="exd-pipeline-stage ${s.highlight ? 'is-highlight' : ''} ${s.clickable ? 'is-clickable' : ''}"
                ${s.clickable ? `onclick="${s.onclick}" title="${s.title}"` : ''}>
                <div class="exd-pipeline-icon" style="background:${s.bg}; color:${s.color};">${iconSvg(s.icon, 18)}</div>
                <div class="exd-pipeline-value">${pipeline[s.key] || 0}</div>
                <div class="exd-pipeline-label">${s.label}</div>
                <div class="exd-pipeline-sub">${s.sub}</div>
            </div>`;
            const connector = i < stages.length - 1
                ? `<div class="exd-pipeline-connector">${iconSvg("chevron", 14)}</div>`
                : '';
            return stage + connector;
        }).join('');
    }

    function renderTaxClaims(taxClaims) {
        const items = (taxClaims && taxClaims.items) || [];
        if (!items.length) {
            return `<div style="font-size:13px;color:var(--exd-text-3);text-align:center;padding:8px 0;">No tax claim data found</div>`;
        }
        return items.map(item => {
            const pct = Math.max(0, Math.min(100, item.percentage || 0));
            const color = taxClaimColor(pct, item.claimed);
            const tooltip = `Debit: ${item.total_fmt || '₹ 0'} | Credit: ${item.received_fmt || '₹ 0'} | Balance: ${item.balance_fmt || '₹ 0'} | Pending: ${item.pending_fmt || '₹ 0'}`;
            return `
                <div class="exd-tax-item is-clickable" onclick="openTaxClaimsReport('${item.key}')" title="Click to view General Ledger for ${item.label}">
                    <div class="exd-tax-head">
                        <span class="exd-tax-title">${item.label} (${pct}%)</span>
                        <span class="exd-tax-nums">Credit ${item.received_fmt || '₹ 0'} / Debit ${item.total_fmt || '₹ 0'}</span>
                    </div>
                    <div class="exd-tax-track" data-tooltip="${tooltip}">
                        <div class="exd-tax-fill" style="width:${pct}%; background:${color};"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function taxClaimColor(pct, claimed) {
        if (!claimed) return "#9ca3af";
        if (pct >= 75) return "#059669";
        if (pct >= 40) return "#d97706";
        return "#dc2626";
    }

    function renderCurrencyAverages(cur) {
        const items = (cur && cur.items) || [];
        if (!items.length) {
            return `<div style="grid-column:1/-1;font-size:13px;color:var(--exd-text-3);text-align:center;padding:8px 0;">No exchange rates in range</div>`;
        }
        return items.map(it => `
            <div>
                <span class="exd-currency-label">${it.currency || ''}</span>
                <span class="exd-currency-value">${it.rate_fmt || ''}</span>
            </div>
        `).join('');
    }

    function renderCurrencyBalances(treasury) {
        const items = (treasury && treasury.currencies) || [];
        if (!items.length) {
            return `<div style="grid-column:1/-1;font-size:13px;color:var(--exd-text-3);text-align:center;padding:8px 0;">No currency balances</div>`;
        }
        return items.map(it => `
            <div>
                <span class="exd-currency-label">${it.currency || ''}</span>
                <span class="exd-currency-value">${it.balance_fmt || ''}</span>
            </div>
        `).join('');
    }

    function renderMiniOrderBar(so) {
        const total = (so && so.count) || 0;
        if (!total) return '';
        const completed = so.completed || 0;
        const pending = so.pending || 0;
        const other = Math.max(total - completed - pending, 0);
        const pc = (completed / total) * 100;
        const pp = (pending / total) * 100;
        const po = Math.max(100 - pc - pp, 0);
        const tooltip = `Completed: ${completed} | Pending: ${pending}${other ? ` | Other: ${other}` : ''} (of ${total} orders)`;
        return `
            <div class="exd-mini-bar" data-tooltip="${tooltip}">
                ${pc ? `<div class="exd-mini-bar-seg" style="width:${pc}%;background:#10b981;"></div>` : ''}
                ${pp ? `<div class="exd-mini-bar-seg" style="width:${pp}%;background:#f59e0b;"></div>` : ''}
                ${po ? `<div class="exd-mini-bar-seg" style="width:${po}%;background:#9ca3af;"></div>` : ''}
            </div>
        `;
    }

    function renderMonthlyChart(data) {
        if (!data || data.length === 0) {
            return '<div style="padding:20px;text-align:center;color:#999;">No revenue data available</div>';
        }

        const maxVal = Math.max(...data.map(d => d.val || 0), 1);

        return `
            <div class="exd-bar-chart" style="height:100%;">
                ${data.map(d => `
                    <div class="exd-bar-item" data-tooltip="${d.month}: ${d.revenue_fmt || '₹ 0'}">
                        <div class="exd-bar" style="height:${Math.max((d.val / maxVal) * 100, 8)}%;background:var(--exd-primary);border-radius:4px 4px 0 0;"></div>
                        <span class="exd-bar-label">${d.month}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderAgingChart(data) {
        const items = data && data.items;
        if (!items || !items.length) {
            return '<div style="padding:20px;text-align:center;color:#999;">No aging data available</div>';
        }

        // Colors ramp from light (not yet due) to dark/red (most overdue),
        // one per bucket returned by the backend (<0, 0-1, 2-7, 8-30, 31-45, 46-Above).
        const colors = ["#e5e7eb", "#c7d2fe", "#a5b4fc", "var(--exd-primary)", "#fb923c", "#f87171"];
        const criticalKeys = ["old30", "old45"];

        return `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:13px;color:var(--exd-text-3);">Total Amount Due</span>
                <span style="font-size:15px;font-weight:600;">${data.total_fmt || '₹ 0'}</span>
            </div>
            <div class="exd-bar-chart" style="height:calc(100% - 22px);align-items:flex-end;">
                ${items.map((item, i) => {
                    const critical = criticalKeys.includes(item.key);
                    return `
                    <div class="exd-bar-item" style="justify-content:flex-end;" data-tooltip="${item.label} days: ${item.value_fmt}">
                        <span class="exd-bar-value" style="${critical ? 'color:#dc2626;' : ''}">${item.value_fmt}</span>
                        <div class="exd-bar" style="height:${Math.max(item.chart || 0, 6)}%;background:${colors[i % colors.length]};border-radius:4px 4px 0 0;"></div>
                        <span class="exd-bar-label" style="${critical ? 'color:#dc2626;' : ''}">${item.label}</span>
                    </div>
                `;
                }).join('')}
            </div>
        `;
    }

    function renderLeaderboards(leaderboards) {
        if (!leaderboards) return '';

        const sections = [
            { key: "topCompanies", title: "Top Suppliers", icon: "globe" },
            { key: "topCustomers", title: "Top Customers", icon: "users" },
            { key: "delayedOrders", title: "Delayed Orders", icon: "alert", critical: true },
            { key: "stockItems", title: "Stock Items", icon: "layers" },
            { key: "topSelling", title: "Top Selling", icon: "trend" },
            { key: "topPurchase", title: "Top Purchase", icon: "cart" },
        ];

        // Sections with the Qty/Amount + Item Group toggle (stockItems,
        // topSelling, topPurchase) always render, even with zero rows for
        // the currently selected filters - the card itself shows a "No
        // data available" message instead of disappearing, so the filter
        // controls stay reachable and the user can pick a different Item
        // Group without the card vanishing from the grid.
        const activeSections = sections.filter(s => {
            if (TOGGLE_SECTIONS[s.key]) return true;
            return leaderboards[s.key] && leaderboards[s.key].length > 0;
        });

        // Rendered as a single 2-column CSS grid in original order (rather
        // than two independently-stacked columns) so each row pair -
        // Companies+Customers, Delayed+Stock, Qty+Value - lands in the same
        // grid row and stretches to match its taller sibling, instead of
        // drifting out of alignment when one card has fewer rows.
        return `
            <div class="exd-bento-span-12 exd-leaderboards">
                <div class="exd-leaderboards-grid">
                    ${activeSections.map(s => renderLeaderboardSection(s, leaderboards[s.key])).join('')}
                </div>
            </div>
        `;
    }

    function renderLeaderboardSection(config, data) {
        const toggle = TOGGLE_SECTIONS[config.key];
        data = data || [];

        // Non-toggle sections keep the original behaviour: no data means
        // the card isn't rendered at all (already filtered out upstream,
        // this is just a safety net).
        if (!toggle && data.length === 0) return '';

        const maxItems = 5;
        const items = data.slice(0, maxItems);
        const hasItems = items.length > 0;
        const labelClass = config.critical ? "exd-card-label exd-label-critical" : "exd-card-label";
        const btnClass = config.critical ? "exd-leaderboard-view-all exd-btn-critical" : "exd-leaderboard-view-all";
        const cardId = toggle ? ` id="exd-lb-${config.key}"` : '';
        const fullWidth = ['topSelling', 'topPurchase'].includes(config.key);

        // Qty Wise/Amount Wise selector and the Item Group filter (when the
        // card has one) sit side by side in the header, at matching size,
        // rather than the Item Group filter taking its own row underneath.
        let headerRight = '';
        if (toggle) {
            const itemGroupSelectHtml = renderCardItemGroupFilterSelect(config.key);
            headerRight = `
                <div class="exd-leaderboard-header-controls">
                    ${itemGroupSelectHtml}
                    ${renderSortSelect(config.key, state[toggle.stateKey])}
                </div>
            `;
        }

        const chartHtml = (config.key === "topCompanies" || config.key === "topCustomers")
            ? renderLeaderboardDonut(items, config.key)
            : '';

        const selectedGroup = toggle ? ((state.cardItemGroupFilters[config.key] || [])[0] || '') : '';
        const emptyMessage = selectedGroup
            ? `No data available for "${selectedGroup}".`
            : `No data available.`;

        return `
            <div class="exd-card exd-anim exd-leaderboard-card"${cardId} style="--delay:12; ${fullWidth ? 'grid-column: 1 / -1;' : ''}">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                    <div class="${labelClass}">${iconSvg(config.icon)} ${config.title}</div>
                    ${headerRight}
                </div>
                ${chartHtml}
                ${hasItems ? renderColHeader(config.key) : ''}
                <div class="exd-leaderboard-list">
                    ${hasItems
                        ? items.map((item, i) => `
                            <div class="exd-leaderboard-item">
                                <div class="exd-leaderboard-rank">${i + 1}</div>
                                <div class="exd-leaderboard-info">
                                    ${renderLeaderboardItem(item, config.key, toggle ? state[toggle.stateKey] : null)}
                                </div>
                            </div>
                        `).join('')
                        : `<div class="exd-leaderboard-empty">${emptyMessage}</div>`
                    }
                </div>
                ${hasItems ? `<button class="${btnClass}" onclick="openModal('${config.title}', '${config.key}')">VIEW ALL →</button>` : ''}
            </div>
        `;
    }

    function formatCompactInr(value) {
        const amount = value || 0;
        const absValue = Math.abs(amount);
        if (absValue >= 1e7) {
            return `₹ ${Number(amount / 1e7).toFixed(2)} Cr`;
        }
        if (absValue >= 1e5) {
            return `₹ ${Number(amount / 1e5).toFixed(2)} L`;
        }
        return `₹ ${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    }

    // Compact Item Group <select>, styled and sized to match the Qty
    // Wise/Amount Wise selector exactly, so both controls sit side by side
    // in the card header at the same height and width.
    function renderCardItemGroupFilterSelect(key) {
        const selectedGroup = (state.cardItemGroupFilters[key] || [])[0] || "";
        return `
            <select id="exd-card-item-group-${key}" class="exd-card-item-group-select exd-mini-toggle-select" title="${selectedGroup || 'Select Item Groups'}">
                ${getItemGroupOptions(selectedGroup)}
            </select>
        `;
    }

    function getItemGroupOptions(selectedGroup = "") {
        if (!state.itemGroupsLoaded) {
            return `<option value="">Loading Item Groups...</option>`;
        }

        let options = `<option value="" ${selectedGroup === "" ? "selected" : ""}>Select Item Groups</option>`;
        if (!state.itemGroups.length) {
            return options;
        }

        options += state.itemGroups
            .map(g => {
                const selected = selectedGroup === g.name ? ' selected' : '';
                return `<option value="${g.name}"${selected}>${g.name}</option>`;
            })
            .join("");
        return options;
    }

    function renderLeaderboardDonut(items, key) {
    if (!items || !items.length) return '';

    const topItems = items.slice(0, 5);
    const total = topItems.reduce((sum, item) => sum + (item.amount || 0), 0);
    if (!total) return '';

    const totalText = formatCompactInr(total);
    const totalSizeClass = totalText.length > 8 ? 'is-long' : '';  // NEW

    const colors = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#14b8a6"];
    let current = 0;
    const stops = topItems.map((item, index) => {
        const pct = ((item.amount || 0) / total) * 100;
        const start = current;
        const end = current + pct;
        current = end;
        return `${colors[index]} ${start}% ${end}%`;
    }).join(", ");

    return `
        <div class="exd-leaderboard-donut-card">
            <div class="exd-donut-wrapper">
                <div class="exd-donut" style="background: conic-gradient(${stops});">
                    <div class="exd-donut-center">
                        <div class="exd-donut-total ${totalSizeClass}">${totalText}</div>
                        <div class="exd-donut-label">Top ${topItems.length}</div>
                    </div>
                </div>
            </div>
            <div class="exd-donut-legend">
                ${topItems.map((item, index) => {
                    const pct = total ? Math.round(((item.amount || 0) / total) * 100) : 0;
                    return `
                        <div class="exd-donut-legend-item" data-tooltip="${item.val || formatCompactInr(item.amount)} · ${pct}%">
                            <span class="exd-donut-swatch" style="background:${colors[index]};"></span>
                            <div class="exd-donut-legend-text">
                                <span class="exd-donut-legend-name">${item.name}</span>
                                <span class="exd-donut-legend-amount">${item.val || formatCompactInr(item.amount)}</span>
                            </div>
                            <span class="exd-donut-legend-percent" style="background:${colors[index]}22; color:${colors[index]};">${pct}%</span>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

    // Leaderboard sections that carry two ranked metrics (qty + amount) and
    // get a Qty/Amount toggle button + fixed-width columns to match.
    const TOGGLE_SECTIONS = {
        stockItems: { stateKey: "stockSort", method: "get_top_stock_items" },
        topSelling: { stateKey: "sellingSort", method: "get_top_selling_items" },
        topPurchase: { stateKey: "purchaseSort", method: "get_top_purchase_items" },
    };

    function renderLeaderboardItem(item, key, sortMode) {
        const wideDisplay = ['topSelling', 'topPurchase'].includes(key);

        if (key === "topCustomers") {
            return `
                <span class="exd-leaderboard-country">${item.country || 'IN'}</span>
                <span class="exd-leaderboard-name">${item.name || 'N/A'}</span>
                <span class="exd-leaderboard-value exd-col-fixed">${item.val || '₹ 0'}</span>
            `;
        } else if (key === "delayedOrders") {
            return `
                <span class="exd-leaderboard-id">${item.id || 'N/A'}</span>
                <span class="exd-leaderboard-name">${item.customer || 'N/A'}</span>
                <span class="exd-leaderboard-delay exd-col-fixed">${item.delay || '0 Days'}</span>
            `;
        } else if (wideDisplay) {
            return `
                <span class="exd-leaderboard-code exd-col-code">${item.item_code || ''}</span>
                <span class="exd-leaderboard-name exd-col-name-narrow">${item.name || 'N/A'}</span>
                <span class="exd-leaderboard-qty exd-col-fixed exd-col-wide">${item.qty || '0'}</span>
                <span class="exd-leaderboard-value exd-col-fixed exd-col-wide">${item.val || '₹ 0'}</span>
            `;
        } else if (sortMode) {
            // Toggle-enabled section: show only the metric currently being ranked by.
            const cell = sortMode === "amount"
                ? `<span class="exd-leaderboard-value exd-col-fixed">${item.val || '₹ 0'}</span>`
                : `<span class="exd-leaderboard-qty exd-col-fixed">${item.qty || '0'}</span>`;
            return `
                <span class="exd-leaderboard-name">${item.name || 'N/A'}</span>
                ${cell}
            `;
        } else {
            return `
                <span class="exd-leaderboard-name">${item.name || 'N/A'}</span>
                <span class="exd-leaderboard-value exd-col-fixed">${item.val || item.qty || 'N/A'}</span>
            `;
        }
    }

    function renderColHeader(key) {
        if (key === "topCustomers") {
            return `
                <div class="exd-leaderboard-colhead">
                    <span></span>
                    <span class="exd-leaderboard-country" style="visibility:hidden;">IN</span>
                    <span class="exd-leaderboard-name">NAME</span>
                    <span class="exd-leaderboard-value exd-col-fixed">VALUE</span>
                </div>`;
        }
        if (key === "delayedOrders") {
            return `
                <div class="exd-leaderboard-colhead">
                    <span></span>
                    <span class="exd-leaderboard-id" style="min-width:78px;">ORDER ID</span>
                    <span class="exd-leaderboard-name">CUSTOMER</span>
                    <span class="exd-leaderboard-delay exd-col-fixed">DELAY</span>
                </div>`;
        }
        if (['topSelling', 'topPurchase'].includes(key)) {
            return `
                <div class="exd-leaderboard-colhead">
                    <span></span>
                    <span class="exd-leaderboard-code exd-col-code">CODE</span>
                    <span class="exd-leaderboard-name exd-col-name-narrow">ITEM</span>
                    <span class="exd-leaderboard-qty exd-col-fixed exd-col-wide">QTY</span>
                    <span class="exd-leaderboard-value exd-col-fixed exd-col-wide">AMOUNT</span>
                </div>`;
        }
        if (TOGGLE_SECTIONS[key]) {
            const sortMode = state[TOGGLE_SECTIONS[key].stateKey];
            const label = sortMode === "amount" ? "AMOUNT" : "QTY";
            return `
                <div class="exd-leaderboard-colhead">
                    <span></span>
                    <span class="exd-leaderboard-name">ITEM</span>
                    <span class="exd-leaderboard-value exd-col-fixed">${label}</span>
                </div>`;
        }
        return `
            <div class="exd-leaderboard-colhead">
                <span></span>
                <span class="exd-leaderboard-name">NAME</span>
                <span class="exd-leaderboard-value exd-col-fixed">VALUE</span>
            </div>`;
    }

    // ============================================================
    // MODAL
    // ============================================================

    function openModal(title, dataKey) {
        const data = state.data?.leaderboards?.[dataKey];
        if (!data) {
            frappe.msgprint("No data available for this section.");
            return;
        }

        $("#exd-modal-title").text(title);
        setModalSubtitle("Top " + data.length);

        // Toggle-enabled sections (Stock/Selling/Purchase Items) show only
        // whichever metric the mini leaderboard is currently sorted by -
        // Qty Wise -> Quantity column only, Amount Wise -> Amount column only.
        // The same Qty Wise/Amount Wise selector as the mini card is offered
        // here too, so the sort can be changed without closing the modal.
        const toggle = TOGGLE_SECTIONS[dataKey];
        const sortMode = toggle ? state[toggle.stateKey] : null;

        let actionHtml = null;
        if (dataKey === "delayedOrders") {
            actionHtml = `<button class="exd-modal-view-btn" onclick="openDelayedSalesOrderList()">View All in Sales Order →</button>`;
        } else if (toggle) {
            actionHtml = renderSortSelect(dataKey, sortMode, `openModal('${title}', '${dataKey}')`);
        }
        setModalStats(data.length, "RECORDS", actionHtml);
        const $table = $("#exd-modal-table");
        $table.find("thead").empty();
        $table.find("tbody").empty();

        let columns = [];
        if (dataKey === "topCustomers") columns = ["#", "Name", "Country", "Value"];
        else if (dataKey === "topCompanies") columns = ["#", "Name", "Value"];
        else if (dataKey === "delayedOrders") columns = ["#", "Order ID", "Customer", "Delay"];
        else if (toggle) columns = ["#", "Item", sortMode === "amount" ? "Amount" : "Quantity"];
        else columns = ["#", "Name", "Value"];

        let thead = "<tr>";
        columns.forEach(col => { thead += `<th>${col}</th>`; });
        thead += "</tr>";
        $table.find("thead").html(thead);

        let tbody = "";
        data.forEach((item, i) => {
            let row = `<tr><td>${i + 1}</td>`;
            if (dataKey === "topCustomers") {
                row += `<td>${item.name || ''}</td><td>${item.country || ''}</td><td>${item.val || ''}</td>`;
            } else if (dataKey === "topCompanies") {
                row += `<td>${item.name || ''}</td><td>${item.val || ''}</td>`;
            } else if (dataKey === "delayedOrders") {
                row += `<td>${item.id || ''}</td><td>${item.customer || ''}</td><td>${item.delay || ''}</td>`;
            } else if (toggle) {
                const cell = sortMode === "amount" ? (item.val || '') : (item.qty || '');
                row += `<td>${item.name || ''}</td><td>${cell}</td>`;
            } else {
                row += `<td>${item.name || ''}</td><td>${item.val || ''}</td>`;
            }
            row += "</tr>";
            tbody += row;
        });

        $table.find("tbody").html(tbody);
        $("#exd-modal").removeClass("hidden");
    }

    function closeModal() {
        $("#exd-modal").addClass("hidden");
    }

    function setModalSubtitle(text) {
        $("#exd-modal-subtitle").text(text || "");
    }

    function setModalStats(count, label, actionHtml) {
        const $stats = $("#exd-modal-stats");
        if (count === null || count === undefined) {
            $stats.hide().empty();
            return;
        }
        $stats.show().html(`
            <div class="exd-modal-stats-main">
                <div class="exd-modal-stats-value">${count}</div>
                <div class="exd-modal-stats-label">${label || 'TOTAL RECORDS'}</div>
            </div>
            ${actionHtml ? `<div style="margin-left:auto;">${actionHtml}</div>` : ''}
        `);
    }

    function statusPill(status) {
        if (!status) return '';
        const s = status.toLowerCase();
        let color = '#6b7280', bg = '#f3f4f6';
        if (s.includes('partial')) { color = '#d97706'; bg = '#fffbeb'; }
        else if (s.includes('pending') || s.includes('to receive') || s.includes('to bill') || s.includes('to deliver')) { color = '#2563eb'; bg = '#eff6ff'; }
        else if (s.includes('complete') || s.includes('received') || s.includes('ordered') || s.includes('closed')) { color = '#059669'; bg = '#ecfdf5'; }
        else if (s.includes('cancel') || s.includes('stop')) { color = '#dc2626'; bg = '#fef2f2'; }
        return `<span class="exd-status-pill" style="color:${color};background:${bg};">${status}</span>`;
    }

    function periodSubtitle() {
        const f = state.filters.from_date, t = state.filters.to_date;
        return (f && t) ? `${frappe.datetime.str_to_user(f)} - ${frappe.datetime.str_to_user(t)}` : '';
    }

    function openTreasuryLedger() {
        const treasury = (state.data && state.data.treasury) || {};
        const accounts = (treasury.accounts || []).map(a => a.account);

        if (!accounts.length) {
            frappe.msgprint("No bank accounts found for the selected filters.");
            return;
        }

        frappe.route_options = {
            from_date: state.filters.from_date,
            to_date: state.filters.to_date,
            account: accounts,
        };
        if (state.filters.company) {
            frappe.route_options.company = state.filters.company;
        }
        frappe.set_route("query-report", "General Ledger");
    }

    function openSalesInvoiceList() {
        const ts = (state.data && state.data.total_sales) || {};
        frappe.route_options = {
            docstatus: 1,
            posting_date: ["between", [ts.from_date, ts.to_date]],
        };
        if (state.filters.company) {
            frappe.route_options.company = state.filters.company;
        }
        frappe.set_route("List", "Sales Invoice");
    }

    function openSalesOrderList(status, pending) {
        const so = (state.data && state.data.sales_orders) || {};
        frappe.route_options = {
            docstatus: 1,
            transaction_date: ["between", [so.from_date, so.to_date]],
        };
        if (pending) {
            frappe.route_options.status = ["in", ["To Deliver and Bill", "To Bill", "To Deliver"]];
        } else if (status) {
            frappe.route_options.status = status;
        }
        if (state.filters.company) {
            frappe.route_options.company = state.filters.company;
        }
        frappe.set_route("List", "Sales Order");
    }

    function openQuotationList(status) {
        const q = (state.data && state.data.quotations) || {};
        frappe.route_options = {
            docstatus: 1,
            transaction_date: ["between", [q.from_date, q.to_date]],
        };
        if (status) {
            frappe.route_options.status = status;
        }
        if (state.filters.company) {
            frappe.route_options.company = state.filters.company;
        }
        frappe.set_route("List", "Quotation");
    }

    function openReceivablesReport() {
        frappe.route_options = {
            report_date: state.filters.to_date,
        };
        if (state.filters.company) {
            frappe.route_options.company = state.filters.company;
        }
        frappe.set_route("query-report", "Accounts Receivable");
    }

    // Accounts Payable Summary's own onload force-resets the "range" filter
    // to Accounts Settings' Default Ageing Range (confirmed set to
    // "30, 60, 90, 120" on this site) - and it does this *inside* the
    // report's own refresh pipeline (set_route_filters -> onload ->
    // refresh), not after it. Waiting on frappe.set_route()'s promise and
    // fixing things up afterwards is a race: that promise can resolve
    // before onload has even run, so the fix-up finds nothing wrong yet and
    // onload clobbers the range right after. Patching onload itself removes
    // the race entirely - our range becomes the last value set inside that
    // exact same call, before the report's first data fetch.
    function patchAgingRangeOnload(range) {
        const reportSettings = frappe.query_reports && frappe.query_reports["Accounts Payable Summary"];
        if (!reportSettings || reportSettings.__exd_range_patched) return false;
        const originalOnload = reportSettings.onload;
        reportSettings.onload = function (report) {
            if (originalOnload) originalOnload.call(this, report);
            report.set_filter_value("range", range);
        };
        reportSettings.__exd_range_patched = true;
        return true;
    }

    // On the very first visit in a session, frappe.query_reports["Accounts
    // Payable Summary"] doesn't exist until the report's own JS has been
    // fetched - which only happens *during* the navigation we're about to
    // trigger - so there's nothing to patch beforehand. Poll for a few
    // hundred ms after navigating, patching (for next time) and forcibly
    // correcting the live report's range as soon as it appears, so this
    // works even cold.
    function enforceAgingRange(range, retriesLeyft) {
        patchAgingRangeOnload(range);
        const report = frappe.query_report;
        if (report && report.report_name === "Accounts Payable Summary" && report.get_filter_value("range") !== range) {
            report.set_filter_value("range", range);
            report.refresh();
        }
        if (retriesLeft > 0) {
            setTimeout(() => enforceAgingRange(range, retriesLeft - 1), 200);
        }
    }

    function openAgingPayablesReport() {
        // Always "as of today" - matches the card, which is a live ageing
        // snapshot independent of the period filter (see get_aging_payables).
        const range = "7,15,30,45";
        const routeOptions = {
            report_date: frappe.datetime.nowdate(),
            range: range,
            ageing_based_on: "Due Date",
        };
        if (state.filters.company) {
            routeOptions.company = state.filters.company;
        }

        patchAgingRangeOnload(range);

        frappe.route_options = routeOptions;
        frappe.set_route("query-report", "Accounts Payable Summary").then(() => {
            enforceAgingRange(range, 10);
        });
    }

    function openTaxClaimsReport(key) {
        // Each claim row (Drawback / IGST Refund / RODTEP) redirects
        // separately, filtered to just that one claim's own account(s) -
        // not all three combined. Falls back to every matched account if
        // called without a key.
        const tc = (state.data && state.data.tax_claims) || {};
        const items = tc.items || [];
        const item = key ? items.find(i => i.key === key) : null;
        const accounts = item ? (item.accounts || []) : (tc.accounts || []);

        frappe.route_options = {
            from_date: tc.from_date,
            to_date: tc.to_date,
            account: accounts,
        };
        if (tc.company || state.filters.company) {
            frappe.route_options.company = tc.company || state.filters.company;
        }
        frappe.set_route("query-report", "General Ledger");
    }

    function openMonthlyRevenueReport() {
        // Same window the Monthly Revenue Trend card itself is plotting
        // (get_total_sales is resolved with the same period_preset/dates).
        const ts = (state.data && state.data.total_sales) || {};
        frappe.route_options = {
            tree_type: "Customer",
            doc_type: "Sales Invoice",
            value_quantity: "Value",
            from_date: ts.from_date,
            to_date: ts.to_date,
            range: "Monthly",
        };
        if (state.filters.company) {
            frappe.route_options.company = state.filters.company;
        }
        frappe.set_route("query-report", "Sales Analytics");
    }

    function openMonthlySalesOrderTrend() {
        const so = (state.data && state.data.total_sales_order) || {};
        frappe.route_options = {
            tree_type: "Customer",
            doc_type: "Sales Order",
            value_quantity: "Value",
            from_date: so.from_date,
            to_date: so.to_date,
            range: "Monthly",
        };
        if (state.filters.company) {
            frappe.route_options.company = state.filters.company;
        }
        frappe.set_route("query-report", "Sales Analytics");
    }

    function openDelayedSalesOrderList() {
        closeModal();
        frappe.route_options = {
            docstatus: 1,
            status: ["in", ["To Deliver and Bill", "To Bill", "To Deliver"]],
        };
        if (state.filters.company) {
            frappe.route_options.company = state.filters.company;
        }
        frappe.set_route("List", "Sales Order");
    }

    const LEADERBOARD_CONFIG = {
        stockItems: { title: "Stock Items", icon: "layers" },
        topSelling: { title: "Top Selling", icon: "trend" },
        topPurchase: { title: "Top Purchase", icon: "cart" },
    };

    // Qty Wise / Amount Wise selector shared by the mini leaderboard card
    // header and the "VIEW ALL" modal, so both always offer the same control.
    function renderSortSelect(key, sortMode, afterSwitchJs) {
        const afterArg = afterSwitchJs ? `, () => { ${afterSwitchJs} }` : '';
        return `
            <select class="exd-mini-toggle-select" onchange="switchLeaderboardSort('${key}', this.value${afterArg})">
                <option value="qty" ${sortMode === "qty" ? "selected" : ""}>Qty Wise</option>
                <option value="amount" ${sortMode === "amount" ? "selected" : ""}>Amount Wise</option>
            </select>
        `;
    }

    function switchLeaderboardSort(key, sortBy, onDone) {
        const toggle = TOGGLE_SECTIONS[key];
        if (!toggle) return;
        if (state[toggle.stateKey] === sortBy) {
            if (onDone) onDone();
            return;
        }
        state[toggle.stateKey] = sortBy;

        const args = buildLeaderboardArgs(key, sortBy);

        frappe.call({
            method: methodRoot + toggle.method,
            args: args,
            callback: function (r) {
                const items = r.message || [];
                state.data.leaderboards[key] = items;
                $(`#exd-lb-${key}`).replaceWith(renderLeaderboardSection({ key, ...LEADERBOARD_CONFIG[key] }, items));
                if (onDone) onDone();
            }
        });
    }

    function buildLeaderboardArgs(key, sortBy) {
        const baseArgs = key === "stockItems"
            ? { company: state.filters.company, sort_by: sortBy }
            : {
                period_preset: state.filters.period_preset,
                company: state.filters.company,
                from_date: state.filters.from_date,
                to_date: state.filters.to_date,
                sort_by: sortBy,
            };

        const item_groups = state.cardItemGroupFilters[key] || [];
        if (item_groups.length) {
            baseArgs.item_groups = item_groups;
        }
        return baseArgs;
    }

    function reapplyCardItemGroupFilters() {
        Object.keys(TOGGLE_SECTIONS).forEach(key => {
            if ((state.cardItemGroupFilters[key] || []).length) {
                refreshLeaderboardCard(key);
            }
        });
    }

    function refreshLeaderboardCard(key) {
        const toggle = TOGGLE_SECTIONS[key];
        if (!toggle) return;
        const sortBy = state[toggle.stateKey];
        const args = buildLeaderboardArgs(key, sortBy);

        frappe.call({
            method: methodRoot + toggle.method,
            args: args,
            callback: function (r) {
                // r.message may legitimately be an empty array (this Item
                // Group has no matching rows) - keep it as-is rather than
                // falling back to stale data, so the card correctly shows
                // "No data available" instead of the previous filter's rows.
                const items = r.message || [];
                state.data.leaderboards[key] = items;
                $(`#exd-lb-${key}`).replaceWith(renderLeaderboardSection({ key, ...LEADERBOARD_CONFIG[key] }, items));
            }
        });
    }

    function openPendingMRModal() {
        $("#exd-modal-title").text("Sales Orders - Pending Material Request");
        setModalSubtitle(periodSubtitle());
        setModalStats(null);
        const $table = $("#exd-modal-table");
        $table.find("thead").html(`
            <tr><th>#</th><th>Sales Order</th><th>Customer</th><th>Date</th><th>Status</th><th>Amount</th></tr>
        `);
        $table.find("tbody").html(`<tr><td colspan="6" style="text-align:center;">Loading...</td></tr>`);
        $("#exd-modal").removeClass("hidden");

        frappe.call({
            method: methodRoot + "get_pending_mr_sales_orders",
            args: {
                period_preset: state.filters.period_preset,
                company: state.filters.company,
                from_date: state.filters.from_date,
                to_date: state.filters.to_date,
            },
            callback: function (r) {
                const items = (r.message && r.message.items) || [];
                setModalStats(items.length, 'PENDING SALES ORDERS');
                if (!items.length) {
                    $table.find("tbody").html(`<tr><td colspan="6" style="text-align:center;">No pending Sales Orders found.</td></tr>`);
                    return;
                }
                const rows = items.map((item, i) => `
                    <tr class="exd-modal-row-clickable" data-so="${item.name}">
                        <td>${i + 1}</td>
                        <td class="exd-modal-key">${item.name}</td>
                        <td>${item.customer || ''}</td>
                        <td>${item.transaction_date || ''}</td>
                        <td>${statusPill(item.status)}</td>
                        <td class="exd-modal-amount">${item.amount_fmt || ''}</td>
                    </tr>
                `).join('');
                $table.find("tbody").html(rows);
            },
            error: function () {
                setModalStats(null);
                $table.find("tbody").html(`<tr><td colspan="6" style="text-align:center;">Failed to load data.</td></tr>`);
            }
        });
    }

    function openPendingPOModal() {
        $("#exd-modal-title").text("Material Requests - Pending PO");
        setModalSubtitle(periodSubtitle());
        setModalStats(null);
        const $table = $("#exd-modal-table");
        $table.find("thead").html(`
            <tr><th>#</th><th>Material Request</th><th>Company</th><th>Date</th><th>Status</th><th>% Ordered</th><th>Amount</th></tr>
        `);
        $table.find("tbody").html(`<tr><td colspan="7" style="text-align:center;">Loading...</td></tr>`);
        $("#exd-modal").removeClass("hidden");

        frappe.call({
            method: methodRoot + "get_pending_po_material_requests",
            args: {
                period_preset: state.filters.period_preset,
                company: state.filters.company,
                from_date: state.filters.from_date,
                to_date: state.filters.to_date,
            },
            callback: function (r) {
                const items = (r.message && r.message.items) || [];
                setModalStats(items.length, 'PENDING MATERIAL REQUESTS');
                if (!items.length) {
                    $table.find("tbody").html(`<tr><td colspan="7" style="text-align:center;">No pending Material Requests found.</td></tr>`);
                    return;
                }
                const rows = items.map((item, i) => `
                    <tr class="exd-modal-row-clickable" data-mr="${item.name}">
                        <td>${i + 1}</td>
                        <td class="exd-modal-key">${item.name}</td>
                        <td>${item.company || ''}</td>
                        <td>${item.transaction_date || ''}</td>
                        <td>${statusPill(item.status)}</td>
                        <td>${item.per_ordered || 0}%</td>
                        <td class="exd-modal-amount">${item.amount_fmt || ''}</td>
                    </tr>
                `).join('');
                $table.find("tbody").html(rows);
            },
            error: function () {
                setModalStats(null);
                $table.find("tbody").html(`<tr><td colspan="7" style="text-align:center;">Failed to load data.</td></tr>`);
            }
        });
    }

    function openReceiptPendingModal() {
        $("#exd-modal-title").text("Purchase Orders - Receipt Pending");
        setModalSubtitle(periodSubtitle());
        setModalStats(null);
        const $table = $("#exd-modal-table");
        $table.find("thead").html(`
            <tr><th>#</th><th>Purchase Order</th><th>Supplier</th><th>Date</th><th>Status</th><th>Amount</th></tr>
        `);
        $table.find("tbody").html(`<tr><td colspan="6" style="text-align:center;">Loading...</td></tr>`);
        $("#exd-modal").removeClass("hidden");

        frappe.call({
            method: methodRoot + "get_receipt_pending_purchase_orders",
            args: {
                period_preset: state.filters.period_preset,
                company: state.filters.company,
                from_date: state.filters.from_date,
                to_date: state.filters.to_date,
            },
            callback: function (r) {
                const items = (r.message && r.message.items) || [];
                setModalStats(items.length, 'PENDING PURCHASE ORDERS');
                if (!items.length) {
                    $table.find("tbody").html(`<tr><td colspan="6" style="text-align:center;">No pending Purchase Orders found.</td></tr>`);
                    return;
                }
                const rows = items.map((item, i) => `
                    <tr class="exd-modal-row-clickable" data-po="${item.name}">
                        <td>${i + 1}</td>
                        <td class="exd-modal-key">${item.name}</td>
                        <td>${item.supplier || ''}</td>
                        <td>${item.transaction_date || ''}</td>
                        <td>${statusPill(item.status)}</td>
                        <td class="exd-modal-amount">${item.amount_fmt || ''}</td>
                    </tr>
                `).join('');
                $table.find("tbody").html(rows);
            },
            error: function () {
                setModalStats(null);
                $table.find("tbody").html(`<tr><td colspan="6" style="text-align:center;">Failed to load data.</td></tr>`);
            }
        });
    }

    function openPendingDeliveryModal() {
        $("#exd-modal-title").text("Sales Orders - Pending Delivery");
        setModalSubtitle(periodSubtitle());
        setModalStats(null);
        const $table = $("#exd-modal-table");
        $table.find("thead").html(`
            <tr><th>#</th><th>Sales Order</th><th>Customer</th><th>Item</th><th>Ordered Qty</th><th>Delivered Qty</th><th>Pending Qty</th></tr>
        `);
        $table.find("tbody").html(`<tr><td colspan="7" style="text-align:center;">Loading...</td></tr>`);
        $("#exd-modal").removeClass("hidden");

        frappe.call({
            method: methodRoot + "get_pending_delivery_sales_orders",
            args: {
                period_preset: state.filters.period_preset,
                company: state.filters.company,
                from_date: state.filters.from_date,
                to_date: state.filters.to_date,
            },
            callback: function (r) {
                const items = (r.message && r.message.items) || [];
                setModalStats(items.length, 'PENDING DELIVERY LINES');
                if (!items.length) {
                    $table.find("tbody").html(`<tr><td colspan="7" style="text-align:center;">No pending deliveries found.</td></tr>`);
                    return;
                }
                const rows = items.map((item, i) => `
                    <tr class="exd-modal-row-clickable" data-so="${item.name}">
                        <td>${i + 1}</td>
                        <td class="exd-modal-key">${item.name}</td>
                        <td>${item.customer || ''}</td>
                        <td>${item.item_code || ''}</td>
                        <td>${item.ordered_qty || 0}</td>
                        <td>${item.delivered_qty || 0}</td>
                        <td>${item.pending_qty || 0}</td>
                    </tr>
                `).join('');
                $table.find("tbody").html(rows);
            },
            error: function () {
                setModalStats(null);
                $table.find("tbody").html(`<tr><td colspan="7" style="text-align:center;">Failed to load data.</td></tr>`);
            }
        });
    }

    // ============================================================
    // TOOLTIPS
    // ============================================================

    function addTooltips() {
        const $tooltip = $('<div id="exd-tooltip" class="exd-tooltip"></div>');
        $("body").append($tooltip);

        $(document).on("mouseenter", "[data-tooltip]", function (e) {
            const text = $(this).data("tooltip");
            if (text) {
                $tooltip.text(text).show();
                const rect = this.getBoundingClientRect();
                const left = rect.left + (rect.width / 2) - ($tooltip.outerWidth() / 2);
                const top = rect.top - $tooltip.outerHeight() - 8;
                $tooltip.css({
                    left: Math.max(10, left) + "px",
                    top: Math.max(10, top) + "px",
                });
            }
        });

        $(document).on("mouseleave", "[data-tooltip]", function () {
            $tooltip.hide();
        });
    }

    // ============================================================
    // ICONS
    // ============================================================

    function iconSvg(name, size) {
        const I = {
            home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
            calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
            refresh: '<path d="M21 12a9 9 0 11-9-9c2.5 0 4.7 1 6.4 2.6L21 8M21 3v5h-5"/>',
            cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
            file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
            globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
            bank: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
            download: '<line x1="12" y1="2" x2="12" y2="15"/><polyline points="19 8 12 15 5 8"/><line x1="2" y1="20" x2="22" y2="20"/>',
            shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
            bar: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
            git: '<circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/>',
            trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
            box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
            truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
            chevron: '<polyline points="9 18 15 12 9 6"/>',
            sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
            moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
            users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
            alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
            layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
            dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
            check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
            clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        };
        const s = size || 15;
        return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;">${I[name] || ""}</svg>`;
    }

    // ============================================================
    // STYLES
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
.exd-page * { box-sizing:border-box; }

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
.exd-page[data-theme="dark"] #exd-content::-webkit-scrollbar-thumb { background: #3a3f52; }
.exd-page[data-theme="dark"] #exd-content::-webkit-scrollbar-thumb:hover { background: #4b5169; }
.exd-page[data-theme="dark"] .exd-card:hover { border-color: #3a3f52; }
.exd-page[data-theme="dark"] .exd-currency-grid > div:hover { background: #262a45; border-color: #3f4570; }
.exd-page[data-theme="dark"] .exd-kv-row.is-clickable:hover { background: #262a45; }
.exd-page[data-theme="dark"] .exd-tooltip { background: rgba(255,255,255,0.92); color: #111827; }

.exd-shell {
    max-width: 100%;
    margin: 0;
    padding: 16px 24px 32px 24px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
}

/* Filter Bar */
.exd-filter-bar {
    background: var(--exd-surface);
    border: 1px solid var(--exd-border);
    border-radius: 12px;
    padding: 12px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    margin-bottom: 12px;
    flex-shrink: 0;
}
.exd-field { position:relative; display:flex; align-items:center; }
.exd-field-icon svg { position:absolute; left:14px; color:var(--exd-text-3); pointer-events:none; }
.exd-field select {
    border:1px solid var(--exd-border);
    border-radius:8px;
    padding:8px 16px 8px 38px;
    font-size:15px;
    font-weight:600;
    color:var(--exd-text);
    background:var(--exd-bg);
    height:40px;
    outline:none;
    appearance:none;
    cursor:pointer;
    min-width:170px;
    transition: background .15s ease, border-color .15s ease;
}
.exd-field select:hover { background:var(--exd-surface); border-color:var(--exd-primary); }
.exd-custom-range {
    display:flex;
    align-items:center;
    gap:10px;
}
.exd-custom-range.hidden { display:none; }
.exd-custom-range .hidden { display:none; }
.exd-custom-range span { font-size:14px; color:var(--exd-text-3); font-weight:600; }
.exd-date-input {
    padding:8px 12px;
    border:1px solid var(--exd-border);
    border-radius:6px;
    background:var(--exd-surface);
    font-size:14.5px;
    font-weight:600;
    color:var(--exd-text);
    outline:none;
    height:40px;
    min-width:140px;
    transition: border-color .15s ease, background .15s ease;
}
.exd-date-input:not(:disabled) { cursor:pointer; }
.exd-date-input:not(:disabled):hover { border-color:var(--exd-primary); }
.exd-date-input:focus { border-color:var(--exd-primary); }
.exd-date-input:disabled {
    background:var(--exd-bg);
    color:var(--exd-text-3);
    font-weight:600;
    cursor:default;
    opacity:1;
}

/* Calendar popup polish - a bit more lift than the library default, plus a
   dark variant (see applyTheme() toggling body.exd-calendar-dark) since the
   popup is appended to <body> and otherwise only follows Frappe's own
   site-wide theme, not this dashboard's independent light/dark toggle. */
.datepicker {
    border-radius: 10px !important;
    box-shadow: 0 8px 28px rgba(0,0,0,0.16) !important;
}
body.exd-calendar-dark .datepicker {
    background: #1c1f2b;
    color: #f3f4f6;
    border-color: #2c2f3d;
    box-shadow: 0 8px 28px rgba(0,0,0,0.45) !important;
}
body.exd-calendar-dark .datepicker--nav { border-color: #2c2f3d; }
body.exd-calendar-dark .datepicker--nav-title,
body.exd-calendar-dark .datepicker--nav-action { color: #f3f4f6; }
body.exd-calendar-dark .datepicker--nav-title:hover,
body.exd-calendar-dark .datepicker--nav-action:hover { background-color: #262a45; }
body.exd-calendar-dark .datepicker--day-name { color: #8b8fa3; }
body.exd-calendar-dark .datepicker--cell { color: #cbd0dc; }
body.exd-calendar-dark .datepicker--cell.-other-month- { color: #4b5169; }
body.exd-calendar-dark .datepicker--cell.-current- { color: #f3f4f6; }
body.exd-calendar-dark .datepicker--cell:hover,
body.exd-calendar-dark .datepicker--cell.-focus- { background: #262a45; }
body.exd-calendar-dark .datepicker--cell.-in-range- { background: #262a45; color: #f3f4f6; }
body.exd-calendar-dark .datepicker--cell.-selected-,
body.exd-calendar-dark .datepicker--cell.-current-.-selected- {
    background: #6366f1;
    color: #fff;
}
body.exd-calendar-dark .datepicker--button {
    color: #a5b4fc;
    border-color: #2c2f3d;
}
body.exd-calendar-dark .datepicker--button:hover { background: #262a45; }

.exd-filter-right { margin-left:auto; display:flex; align-items:center; gap:8px; }
.exd-icon-btn {
    width:32px; height:32px;
    border-radius:8px;
    border:1px solid var(--exd-border);
    background:var(--exd-surface);
    color:var(--exd-text-2);
    display:flex;
    align-items:center;
    justify-content:center;
    cursor:pointer;
    transition:all .2s;
}
.exd-icon-btn:hover { background:var(--exd-bg); border-color:var(--exd-primary); }
.exd-btn {
    padding:4px 14px;
    border-radius:6px;
    font-size:14px;
    font-weight:700;
    border:none;
    cursor:pointer;
    transition:all .2s;
}
.exd-btn-primary { background:var(--exd-primary); color:#fff; }
.exd-btn-primary:hover { background:var(--exd-primary-dark); }
#exd-apply-range {
    height:40px;
    padding:0 20px;
    font-size:14.5px;
    background:var(--exd-text);
    color:var(--exd-bg);
}
#exd-apply-range:hover { opacity:0.85; }

/* Content - Full height with scroll */
#exd-content {
    flex: 1;
    padding: 8px 4px 24px 4px;
}

/* Custom scrollbar for content */
#exd-content::-webkit-scrollbar {
    width: 6px;
}
#exd-content::-webkit-scrollbar-track {
    background: transparent;
}
#exd-content::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 10px;
}
#exd-content::-webkit-scrollbar-thumb:hover {
    background: #9ca3af;
}

/* Bento Grid */
.exd-bento {
    display:grid;
    grid-template-columns:repeat(12,1fr);
    gap:20px;
}
.exd-bento-span-3 { grid-column:span 3; }
.exd-bento-span-4 { grid-column:span 4; }
.exd-bento-span-5 { grid-column:span 5; }
.exd-bento-span-6 { grid-column:span 6; }
.exd-bento-span-7 { grid-column:span 7; }
.exd-bento-span-12 { grid-column:span 12; }

/* Animations */
.exd-anim {
    opacity:0;
    animation:exd-slide-up .4s cubic-bezier(.16,1,.3,1) forwards;
    animation-delay: calc(var(--delay, 0) * 0.04s);
}
@keyframes exd-slide-up {
    from{opacity:0; transform:translateY(10px);}
    to{opacity:1; transform:translateY(0);}
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
.exd-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 2px 4px rgba(16,24,40,0.05), 0 12px 24px -8px rgba(16,24,40,0.12);
    border-color: #dfe3ea;
}
/* Decorative blur-blob accent (top-right) */
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
.exd-card-label svg { width: 13px; height: 13px; color: var(--exd-primary); flex-shrink: 0; }

/* Header row controls (Item Group filter + Qty Wise/Amount Wise) - sit
   side by side, same height and width, in the card's top-right corner. */
.exd-leaderboard-header-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

/* Qty Wise / Amount Wise selector (e.g. Stock Items) - an explicit dropdown
   so both options are visible, rather than a single button that only shows
   the view you'd switch TO. Shared by the mini card header and the modal.
   Also reused (with the .exd-card-item-group-select modifier) for the Item
   Group filter, so both controls in the header render identically. */
.exd-mini-toggle-select {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    border: 1.5px solid var(--exd-text);
    background-color: var(--exd-surface);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%23111827' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    background-size: 10px 6px;
    color: var(--exd-text);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.2px;
    padding: 5px 26px 5px 10px;
    border-radius: 6px;
    cursor: pointer;
    outline: none;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    transition: all .15s ease;
    width: 132px;
    height: 30px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.exd-mini-toggle-select:hover { background-color: var(--exd-bg); }
.exd-mini-toggle-select:focus { box-shadow: 0 0 0 2px rgba(17,24,39,0.14); }
.exd-mini-toggle-select option { color: #111827; background: #fff; }

.exd-page[data-theme="dark"] .exd-mini-toggle-select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%23f3f4f6' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
.exd-page[data-theme="dark"] .exd-mini-toggle-select:focus { box-shadow: 0 0 0 2px rgba(243,244,246,0.14); }

/* Item Group select: same height as Qty Wise/Amount Wise, but a bit wider
   since Item Group names tend to run longer - keeps them readable instead
   of being ellipsis-truncated into something unrecognisable. */
.exd-card-item-group-select {
    width: 172px;
}

/* CODE / ITEM / QTY / AMOUNT column layout for Top Selling & Top Purchase -
   Item Code is shown, so the Item name column is narrowed and the Qty and
   Amount columns are widened to compensate. */
.exd-col-code {
    min-width: 200px;
    max-width: 200px;
     flex-shrink: 0;
    font-weight: 700;
    color: var(--exd-text-3);
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.exd-col-name-narrow {
    flex: 0 1 28%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.exd-col-wide {
    min-width: 96px;
}
.exd-leaderboard-value.exd-col-wide {
    margin-left: 18px;
}

/* Column header row above a leaderboard list (e.g. Stock Items) */
.exd-leaderboard-colhead {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0 2px;
    margin-top: 4px;
}
.exd-leaderboard-colhead > span:first-child { width: 20px; flex-shrink: 0; }
.exd-leaderboard-colhead .exd-leaderboard-name,
.exd-leaderboard-colhead .exd-col-fixed {
    font-size: 11px;
    font-weight: 700;
    color: var(--exd-text-3);
    text-transform: uppercase;
    letter-spacing: 0.3px;
}
.exd-col-fixed { min-width: 64px; text-align: right; flex-shrink: 0; }

/* Empty state shown inside a leaderboard card when the current Item Group
   filter (or the underlying data) has no matching rows - the card itself
   stays visible (with its filter controls) instead of disappearing. */
.exd-leaderboard-empty {
    padding: 24px 8px;
    text-align: center;
    font-size: 13px;
    font-weight: 600;
    color: var(--exd-text-3);
}

/* Gradient Card for Conversion Ratio - a deliberate signature "hero" card,
   kept dark in both light and dark page themes (matches the monochrome
   black/white treatment used elsewhere - Apply button, sort dropdown,
   modal hover) rather than a colored accent that would clash with it. */
.exd-card-primary-gradient {
    background: linear-gradient(135deg, #2b2f3a, #05060a);
    border: none;
    color: #fff;
    box-shadow: 0 8px 20px -6px rgba(0,0,0,0.45);
}
.exd-card-primary-gradient::after {
    content: "";
    position: absolute;
    top: -30px;
    right: -30px;
    width: 110px;
    height: 110px;
    border-radius: 50%;
    background: rgba(255,255,255,0.07);
    pointer-events: none;
}

/* TOTAL SALES */
.exd-card-sales {
    display: flex;
    flex-direction: column;
}
.exd-card-sales .exd-card-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--exd-text-3);
    letter-spacing: 0.6px;
    margin-bottom: 6px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
}
.exd-card-sales-dual {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
}
.exd-card-sales-half {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.exd-card-value-large {
    font-size: 44px;
    font-weight: 900;
    line-height: 1.05;
    letter-spacing: -0.5px;
    background: linear-gradient(90deg, var(--exd-text), var(--exd-primary));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: var(--exd-text);
}
.exd-card-sales-sub {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 4px;
    font-size: 14px;
    font-weight: 700;
    color: #059669;
    background: #ecfdf5;
    border: 1px solid #d1fae5;
    padding: 3px 10px;
    border-radius: 999px;
    margin-top: 8px;
}
.exd-card-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 28px;
    padding-top: 20px;
    border-top: 1px solid var(--exd-border);
}
.exd-card-stats > div {
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.exd-stat-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--exd-text-3);
    text-transform: uppercase;
    letter-spacing: 0.4px;
}
.exd-stat-value {
    font-size: 22px;
    font-weight: 800;
    color: var(--exd-text);
}
.exd-text-green { color: #059669; }
.exd-text-yellow { color: #d97706; }
.exd-text-red { color: #dc2626; }
.exd-stat-label svg { margin-right: 3px; }

.exd-mini-bar {
    display: flex;
    width: 100%;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    margin-top: 14px;
    background: var(--exd-border);
    cursor: default;
}
.exd-mini-bar-seg {
    height: 100%;
    transition: width 0.3s ease;
}

/* QUOTATIONS */
.exd-card-quotations .exd-card-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--exd-text-3);
    letter-spacing: 0.6px;
    margin-bottom: 6px;
}
.exd-quotation-total {
    margin-bottom: 10px;
}
.exd-quotation-total .exd-stat-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--exd-text-3);
    text-transform: uppercase;
    letter-spacing: 0.4px;
}
.exd-quotation-total .exd-card-value {
    font-size: 27px;
    font-weight: 900;
    color: var(--exd-text);
}
.exd-quotation-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 28px;
    padding-top: 20px;
    border-top: 1px solid var(--exd-border);
}
.exd-quotation-stats > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.exd-quotation-stats .exd-stat-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--exd-text-3);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    white-space: nowrap;
}
.exd-quotation-stats .exd-stat-value {
    font-size: 20px;
    font-weight: 800;
    white-space: nowrap;
}

/* CONVERSION - Gradient */
.exd-card-conversion .exd-card-label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.6px;
    margin-bottom: 6px;
    color: rgba(255,255,255,0.8);
}
.exd-conversion-main {
    display: flex;
    align-items: baseline;
    gap: 10px;
}
.exd-conversion-value {
    font-size: 31px;
    font-weight: 900;
    color: var(--exd-text);
}
.exd-conversion-trend {
    font-size: 14px;
    font-weight: 800;
    color: #A7F3D0;
    background: rgba(255,255,255,0.15);
    padding: 2px 8px;
    border-radius: 999px;
}
.exd-conversion-sub {
    font-size: 11px;
    color: var(--exd-text-3);
    font-weight: 500;
    margin-top: 2px;
}

/* CURRENCY */
.exd-card-currency .exd-card-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--exd-text-3);
    letter-spacing: 0.6px;
    margin-bottom: 6px;
}
.exd-currency-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 6px;
}
.exd-currency-grid > div {
    background: var(--exd-bg);
    padding: 10px 10px;
    border-radius: 8px;
    border: 1px solid var(--exd-border);
    text-align: center;
    transition: background .2s ease, border-color .2s ease;
}
.exd-currency-grid > div:hover {
    background: #eef2ff;
    border-color: #c7d2fe;
}
.exd-currency-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: var(--exd-text-3);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-bottom: 2px;
}
.exd-currency-value {
    font-size: 16px;
    font-weight: 800;
    color: var(--exd-text);
}

/* Sub-pill icon */
.exd-card-sub svg { width: 12px; height: 12px; }

/* TAX CLAIMS progress bars */
.exd-tax-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 7px;
}
.exd-tax-title {
    font-size: 13px;
    font-weight: 800;
    color: var(--exd-text-2);
    text-transform: uppercase;
    letter-spacing: 0.3px;
}
.exd-tax-nums {
    font-size: 12px;
    font-weight: 600;
    color: var(--exd-text-3);
}
.exd-tax-track {
    width: 100%;
    height: 8px;
    background: #eef0f4;
    border-radius: 999px;
    overflow: hidden;
}
.exd-tax-fill {
    height: 100%;
    border-radius: 999px;
    transition: width .6s cubic-bezier(.16,1,.3,1);
}
.exd-tax-item {
    padding: 6px 8px;
    margin: -6px -8px;
    border-radius: 8px;
    transition: background .15s ease;
}
.exd-tax-item.is-clickable { cursor: pointer; }
.exd-tax-item.is-clickable:hover { background: #eef2ff; }
.exd-page[data-theme="dark"] .exd-tax-item.is-clickable:hover { background: #262a45; }

/* PIPELINE */
.exd-pipeline {
    display: grid;
    grid-template-columns: 1fr 32px 1fr 32px 1fr 32px 1fr;
    align-items: stretch;
}
.exd-pipeline-stage {
    text-align: center;
    padding: 16px 12px;
    background: var(--exd-bg);
    border: 1px solid var(--exd-border);
    border-radius: 12px;
    position: relative;
    z-index: 1;
}
.exd-pipeline-stage.is-highlight {
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
}
.exd-pipeline-stage.is-clickable {
    cursor: pointer;
    transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
}
.exd-pipeline-stage.is-clickable:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 20px rgba(17,24,39,0.10);
    border-color: var(--exd-primary);
}
.exd-pipeline-icon {
    width: 36px;
    height: 36px;
    margin: 0 auto 8px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
}
.exd-pipeline-value {
    font-size: 29px;
    font-weight: 900;
    color: var(--exd-text);
    line-height: 1.1;
}
.exd-pipeline-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--exd-text-2);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-top: 6px;
}
.exd-pipeline-sub {
    font-size: 10px;
    font-weight: 600;
    color: var(--exd-text-3);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-top: 2px;
}
.exd-pipeline-connector {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--exd-text-3);
    z-index: 0;
}
.exd-pipeline-connector::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 2px;
    background: linear-gradient(90deg, var(--exd-border), var(--exd-primary), var(--exd-border));
    opacity: 0.5;
    transform: translateY(-50%);
}
.exd-pipeline-connector svg {
    position: relative;
    background: var(--exd-surface);
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--exd-surface);
    color: var(--exd-primary);
}

/* KV Row */
.exd-kv-row {
    display:flex;
    align-items:center;
    justify-content:space-between;
    background:var(--exd-bg);
    border-radius:6px;
    padding:8px 12px;
    font-size:13px;
    font-weight:600;
    color:var(--exd-text-2);
}
.exd-kv-row b { font-size:16px; font-weight:800; color:var(--exd-text); }
.exd-kv-warn { background:#fffbeb; color:#b45309; }
.exd-kv-row.is-clickable { cursor:pointer; transition:background .15s ease, box-shadow .15s ease; }
.exd-kv-row.is-clickable:hover { background:#eef2ff; box-shadow:inset 2px 0 0 var(--exd-primary); }
.exd-page[data-theme="dark"] .exd-kv-warn { background:#3a2c10; color:#fbbf24; }
.exd-page[data-theme="dark"] .exd-kv-warn b { color:#fde68a; }
.exd-page[data-theme="dark"] .exd-kv-warn.is-clickable:hover { background:#4a3714; }

/* Currency Row (for Treasury/Receivables) */
.exd-currency-row {
    display:grid;
    grid-template-columns:repeat(2,1fr);
    gap:6px;
    margin-top:6px;
}
.exd-currency-row > div {
    background:var(--exd-bg);
    border-radius:6px;
    padding:5px 8px;
    text-align:center;
}
.exd-currency-row span {
    display:block;
    font-size:10px;
    font-weight:700;
    color:var(--exd-text-3);
    text-transform:uppercase;
}
.exd-currency-row b { font-size:13px; font-weight:800; color:var(--exd-text); }

/* Charts */
.exd-chart-container {
    margin-top:10px;
    height:160px;
}
/* Donut Chart - Improved */
/* Donut Chart - Improved */
.exd-leaderboard-donut-card {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 32px;
    align-items: center;
    padding: 24px 16px 16px 16px;
    margin-top: 12px;
    border-bottom: 1px solid var(--exd-border);
}

.exd-donut-wrapper {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 8px;
}

.exd-donut {
    width: 200px;
    height: 200px;
    border-radius: 50%;
    position: relative;
    box-shadow: 
        0 10px 34px rgba(0, 0, 0, 0.12),
        0 2px 10px rgba(0, 0, 0, 0.05),
        inset 0 0 0 1px rgba(0, 0, 0, 0.03);   /* NEW — thin crisp edge, reads less "flat" */
    transition: transform 0.3s ease;
    flex-shrink: 0;
}

.exd-donut:hover {
    transform: scale(1.02);
}

.exd-donut::before {
    content: '';
    position: absolute;
    width: 130px;    /* was 110px — bigger hole, real breathing room around the text */
    height: 130px;
    border-radius: 50%;
    background: var(--exd-surface);
    inset: 0;
    margin: auto;
    box-shadow:
        inset 0 2px 10px rgba(0, 0, 0, 0.05),   /* NEW — soft depth so the hole doesn't look pasted-on flat */
        0 0 0 1px rgba(0, 0, 0, 0.02);
}

.exd-donut-center {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    z-index: 2;
    width: 130px;     /* matches new hole size */
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0 14px;  /* keeps text a fixed distance from the ring on all sides */
}

.exd-donut-total {
    font-size: 19px;      /* was 26px — the main fix; 26px had nowhere to go */
    font-weight: 800;
    color: var(--exd-text);
    line-height: 1.15;
    letter-spacing: -0.2px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* NEW — extra shrink step for longer figures (e.g. "₹ 2.55 Cr", "$ 128.4K")
   so nothing ever gets clipped or pushed against the ring */
.exd-donut-total.is-long {
    font-size: 16px;
}

.exd-donut-label {
    font-size: 10px;      /* was 11px */
    font-weight: 700;
    color: var(--exd-text-3);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 3px;
}

.exd-donut-legend {
    display: grid;
    gap: 10px;
    padding: 4px 0;
}

.exd-donut-legend-item {
    display: grid;
    grid-template-columns: 14px 1fr auto;
    gap: 14px;
    align-items: center;
    padding: 6px 8px;
    border-radius: 8px;
    transition: background 0.15s ease;
    cursor: default;
}

.exd-donut-legend-item:hover {
    background: var(--exd-bg);
}

.exd-donut-legend-item:hover .exd-donut-legend-percent {
    transform: scale(1.05);
}

.exd-donut-swatch {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
    border: 1px solid rgba(0, 0, 0, 0.04);
}

.exd-donut-legend-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.exd-donut-legend-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--exd-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.1px;
}

.exd-donut-legend-amount {
    font-size: 11px;
    color: var(--exd-text-3);
    font-weight: 500;
    margin-top: 1px;
}

.exd-donut-legend-percent {
    font-size: 11px;
    font-weight: 700;
    color: var(--exd-text-3);
    white-space: nowrap;
    padding: 2px 10px;
    border-radius: 12px;
    transition: all 0.2s ease;
    flex-shrink: 0;
}

.exd-bar-chart {
    display:flex;
    align-items:flex-end;
    justify-content:space-between;
    height:100%;
    gap:4px;
}
.exd-bar-item {
    display:flex;
    flex-direction:column;
    align-items:center;
    flex:1;
    height:100%;
    justify-content:flex-end;
    cursor:default;
}
.exd-bar {
    width:100%;
    max-width:36px;
    min-height:6px;
    transition:all .3s;
    background: var(--exd-primary);
}
.exd-bar:hover { opacity:0.8; transform:scaleY(1.05); }
.exd-bar-label {
    font-size:10px;
    font-weight:700;
    color:var(--exd-text-3);
    margin-top:6px;
    text-transform:uppercase;
}
.exd-bar-value {
    font-size:10px;
    font-weight:700;
    color:var(--exd-text-2);
    margin-bottom:3px;
}

/* Leaderboards */
.exd-leaderboards {
    margin-top:0;
}
.exd-leaderboards-grid {
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:12px;
    align-items:stretch;
}
.exd-leaderboard-card {
    display:flex;
    flex-direction:column;
    height:100%;
}
.exd-leaderboard-card .exd-leaderboard-list { flex:1; }
.exd-leaderboard-card .exd-leaderboard-view-all { margin-top:auto; }
.exd-leaderboard-list {
    margin-top:6px;
}
.exd-leaderboard-item {
    display:flex;
    align-items:center;
    gap:8px;
    padding:4px 0;
    border-bottom:1px solid var(--exd-border);
    font-size:14px;
}
.exd-leaderboard-item:last-child { border-bottom:none; }
.exd-leaderboard-rank {
    width:20px;
    height:20px;
    background:var(--exd-bg);
    border-radius:50%;
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:11px;
    font-weight:700;
    color:var(--exd-text-3);
    flex-shrink:0;
}
.exd-leaderboard-info {
    flex:1;
    display:flex;
    align-items:center;
    gap:6px;
}
.exd-leaderboard-name { flex:1; font-weight:600; color:var(--exd-text); font-size:14px; }
.exd-leaderboard-country {
    font-size:10px;
    font-weight:700;
    color:var(--exd-text-3);
    background:var(--exd-bg);
    padding:1px 5px;
    border-radius:3px;
    min-width:106px;
    max-width:106px;
    flex-shrink:0;
    text-align:left;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
}
.exd-leaderboard-value { font-weight:700; color:var(--exd-text); font-size:14px; }
.exd-leaderboard-qty { font-weight:600; color:var(--exd-primary); font-size:13px; }
.exd-leaderboard-code { font-weight:700; color:var(--exd-text-3); font-size:13px; min-width:100px; }
.exd-leaderboard-id { font-weight:700; color:var(--exd-text); font-size:13px;  }
.exd-leaderboard-delay { font-weight:700; color:#dc2626; font-size:13px; }
.exd-leaderboard-view-all {
    width:100%;
    margin-top:8px;
    padding:6px;
    background:var(--exd-bg);
    border:none;
    border-radius:6px;
    font-size:12px;
    font-weight:700;
    color:var(--exd-primary);
    cursor:pointer;
    transition:all .2s;
}
.exd-leaderboard-view-all:hover { background:var(--exd-primary); color:#fff; }
.exd-label-critical, .exd-label-critical svg { color:#dc2626; }
.exd-btn-critical { background:#fef2f2; color:#dc2626; }
.exd-btn-critical:hover { background:#dc2626; color:#fff; }
.exd-page[data-theme="dark"] .exd-btn-critical { background:#3a1414; color:#f87171; }
.exd-page[data-theme="dark"] .exd-btn-critical:hover { background:#dc2626; color:#fff; }
.exd-page[data-theme="dark"] .exd-label-critical, .exd-page[data-theme="dark"] .exd-label-critical svg { color:#f87171; }

/* Modal */
.exd-modal {
    position:fixed;
    inset:0;
    z-index:1000;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:20px;
}
.exd-modal.hidden { display:none; }
.exd-modal-overlay {
    position:absolute;
    inset:0;
    background:rgba(0,0,0,0.5);
    cursor:pointer;
}
.exd-modal-content {
    position:relative;
    background:var(--exd-surface);
    border-radius:16px;
    max-width:840px;
    width:100%;
    max-height:82vh;
    display:flex;
    flex-direction:column;
    box-shadow:0 24px 70px rgba(0,0,0,0.25);
    overflow:hidden;
}
.exd-modal-header {
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    padding:20px 24px;
    border-bottom:1px solid var(--exd-border);
}
.exd-modal-header h3 {
    font-size:20px;
    font-weight:800;
    margin:0;
    color:var(--exd-text);
}
.exd-modal-subtitle {
    font-size:14px;
    font-weight:600;
    color:var(--exd-text-3);
    margin-top:3px;
}
.exd-modal-close {
    width:32px;
    height:32px;
    flex:0 0 auto;
    border:1px solid var(--exd-border);
    background:var(--exd-surface);
    border-radius:8px;
    font-size:18px;
    line-height:1;
    color:var(--exd-text-2);
    cursor:pointer;
    transition:background .15s ease, border-color .15s ease;
}
.exd-modal-close:hover { background:var(--exd-bg); border-color:var(--exd-text-3); }
.exd-modal-stats {
    display:flex;
    align-items:center;
    padding:16px 24px;
    background:var(--exd-bg);
    border-bottom:1px solid var(--exd-border);
}
.exd-modal-stats-main { display:flex; flex-direction:column; }
.exd-modal-stats-value {
    font-size:31px;
    font-weight:900;
    color:var(--exd-text);
    line-height:1.1;
}
.exd-modal-stats-label {
    font-size:12px;
    font-weight:700;
    color:var(--exd-text-3);
    text-transform:uppercase;
    letter-spacing:0.4px;
    margin-top:2px;
}
.exd-modal-body {
    flex:1;
    overflow-y:auto;
    padding:8px 24px 20px;
}
.exd-modal-table {
    width:100%;
    border-collapse:collapse;
    font-size:14.5px;
}
.exd-modal-table th {
    text-align:left;
    padding:10px;
    font-size:11px;
    font-weight:700;
    color:var(--exd-text-3);
    text-transform:uppercase;
    letter-spacing:0.3px;
    border-bottom:2px solid var(--exd-border);
    background:var(--exd-surface);
    position:sticky;
    top:0;
}
.exd-modal-table td {
    padding:10px;
    border-bottom:1px solid var(--exd-border);
    color:var(--exd-text-2);
}
.exd-modal-table td:last-child { white-space:nowrap; }
.exd-modal-table tbody tr:nth-child(even) td { background:var(--exd-bg); }
.exd-modal-table tbody tr:hover td {
    background: color-mix(in srgb, var(--exd-text) 8%, transparent);
}
.exd-modal-key { font-weight:700; color:var(--exd-text); }
.exd-modal-amount { font-weight:700; color:var(--exd-text); text-align:right; }
.exd-status-pill {
    display:inline-block;
    padding:3px 10px;
    border-radius:999px;
    font-size:12.5px;
    font-weight:700;
    white-space:nowrap;
}
.exd-modal-row-clickable { cursor: pointer; }
.exd-modal-view-btn {
    border: 1px solid var(--exd-primary);
    background: transparent;
    color: var(--exd-primary);
    font-size: 13px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: all .15s ease;
}
.exd-modal-view-btn:hover { background: var(--exd-primary); color: #fff; }

/* Shimmer */
.exd-shimmer {
    background:linear-gradient(90deg,#f0f0f0 25%,#e5e7eb 50%,#f0f0f0 75%);
    background-size:200% 100%;
    animation:shimmer 1.5s infinite;
    border-radius:10px;
}
@keyframes shimmer {
    0% { background-position:200% 0; }
    100% { background-position:-200% 0; }
}

/* Tooltip */
.exd-tooltip {
    position:fixed;
    background:rgba(0,0,0,0.85);
    color:#fff;
    font-size:12px;
    padding:5px 10px;
    border-radius:5px;
    pointer-events:none;
    z-index:10000;
    display:none;
}

/* Error */
.exd-error {
    text-align:center;
    padding:40px 20px;
    background:var(--exd-surface);
    border-radius:12px;
    border:1px solid var(--exd-border);
}
.exd-error p { color:var(--exd-text-3); margin-bottom:14px; font-size:15px; }

/* Responsive */
@media (max-width:1024px) {
    .exd-bento-span-3,.exd-bento-span-4,.exd-bento-span-5,.exd-bento-span-6,.exd-bento-span-7 {
        grid-column:span 12;
    }
    .exd-pipeline { grid-template-columns:repeat(2,1fr); gap:12px; }
    .exd-pipeline-connector { display:none; }
    .exd-leaderboards-grid { grid-template-columns:1fr; }
    .exd-filter-bar { flex-direction:column; align-items:stretch; }
    .exd-filter-right { margin-left:0; }
    .exd-custom-range { flex-wrap:wrap; }
     .exd-leaderboard-donut-card {
        grid-template-columns: 1fr;
        gap: 20px;
        padding: 16px 12px;
    }
    .exd-donut { width: 170px; height: 170px; }
.exd-donut::before { width: 108px; height: 108px; }
.exd-donut-center { width: 108px; padding: 0 10px; }
.exd-donut-total { font-size: 17px; }
.exd-donut-total.is-long { font-size: 14px; }
}
}
@media (max-width:768px) {
    .exd-shell { padding:8px 12px; }
    .exd-card { padding:12px 14px; }
    .exd-card-value-large { font-size:27px; }
    .exd-card-stats { grid-template-columns:1fr 1fr; }
    .exd-pipeline { grid-template-columns:1fr; gap:12px; }
    .exd-pipeline-connector { display:none; }
    .exd-chart-container { height:120px; }
    .exd-card-value { font-size:22px; }
    .exd-bento { gap:8px; }
      .exd-leaderboard-donut-card {
        padding: 12px 8px;
    }
    .exd-donut { width: 150px; height: 150px; }
.exd-donut::before { width: 96px; height: 96px; }
.exd-donut-center { width: 96px; padding: 0 8px; }
.exd-donut-total { font-size: 15px; }
.exd-donut-total.is-long { font-size: 13px; }
.exd-donut-label { font-size: 9px; }
}
</style>`);
    }
};