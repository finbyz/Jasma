// jasma/jasma/page/accounts_dashboard/accounts_dashboard.js

frappe.pages["accounts-dashboard"].on_page_load = function (wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Accounts Dashboard"),
        single_column: true,
    });

    const methodRoot = "jasma.jasma.page.accounts_dashboard.accounts_dashboard.";

    const state = {
        filters: {
            period_preset: "yearly",
            company: null,
            from_date: null,
            to_date: null,
        },
        data: null,
        agingView: "overall", // "overall" | "supplier_group"
        selectedSupplierGroup: null, // null (all) or specific supplier_group name
        theme: localStorage.getItem("acd_theme") || localStorage.getItem("exd_theme") || "light",
    };

    const $page = $(wrapper).find(".page-content");
    $page.css("padding", "0");
    injectStyles();
    $page.addClass("acd-page").html(getLayout());
    applyTheme();

    bindEvents();
    setupDatePickers();
    loadPageData();

    // ============================================================
    // THEME MANAGEMENT
    // ============================================================
    function applyTheme() {
        $page.attr("data-theme", state.theme);
        $("#acd-theme-toggle").html(iconSvg(state.theme === "dark" ? "sun" : "moon"));
        $("#acd-theme-toggle").attr(
            "title",
            state.theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"
        );
        $("body").toggleClass("acd-calendar-dark", state.theme === "dark");
    }

    function toggleTheme() {
        state.theme = state.theme === "dark" ? "light" : "dark";
        localStorage.setItem("acd_theme", state.theme);
        applyTheme();
    }

    // ============================================================
    // LAYOUT HTML
    // ============================================================
    function getLayout() {
        return `
        <div class="acd-shell">

            <!-- FILTER BAR -->
            <div class="acd-filter-bar">
                <div class="acd-field acd-field-icon">
                    ${iconSvg("home")}
                    <select id="acd-company">
                        <option value="">All Companies</option>
                        ${getCompanyOptions()}
                    </select>
                </div>
                <div class="acd-field acd-field-icon">
                    ${iconSvg("calendar")}
                    <select id="acd-period">
                        <option value="yearly" selected>This Financial Year</option>
                        <option value="previous_fy">Previous Financial Year</option>
                        <option value="quarterly">Quarterly (Last 3 Months)</option>
                        <option value="monthly">Monthly</option>
                        <option value="weekly">Weekly</option>
                        <option value="custom">Custom Range</option>
                    </select>
                </div>
                <div id="acd-custom-range" class="acd-custom-range">
                    <input type="text" id="acd-date-from" class="acd-date-input" title="From Date" placeholder="DD-MM-YYYY" autocomplete="off" readonly disabled>
                    <span>to</span>
                    <input type="text" id="acd-date-to" class="acd-date-input" title="To Date" placeholder="DD-MM-YYYY" autocomplete="off" readonly disabled>
                    <button class="acd-btn acd-btn-primary hidden" id="acd-apply-range">Apply</button>
                </div>
                <div class="acd-filter-right">
                    <button class="acd-icon-btn" id="acd-theme-toggle" title="Switch Theme">${iconSvg("moon")}</button>
                    <button class="acd-icon-btn" id="acd-refresh" title="Refresh Dashboard">${iconSvg("refresh")}</button>
                </div>
            </div>

            <!-- DASHBOARD CONTENT -->
            <div id="acd-content" class="acd-content-full">
                ${shimmerBlock(450)}
            </div>

            <!-- DETAIL MODAL -->
            <div id="acd-modal" class="acd-modal hidden">
                <div class="acd-modal-overlay" onclick="closeAcdModal()"></div>
                <div class="acd-modal-content">
                    <div class="acd-modal-header">
                        <div>
                            <h3 id="acd-modal-title">View All</h3>
                            <div class="acd-modal-subtitle" id="acd-modal-subtitle"></div>
                        </div>
                        <button class="acd-modal-close" onclick="closeAcdModal()">×</button>
                    </div>
                    <div class="acd-modal-stats" id="acd-modal-stats"></div>
                    <div class="acd-modal-body" id="acd-modal-body">
                        <table class="acd-modal-table" id="acd-modal-table">
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

    function shimmerBlock(h) {
        return `<div class="acd-shimmer" style="height:${h || 200}px; border-radius:16px;"></div>`;
    }

    // ============================================================
    // EVENT BINDINGS
    // ============================================================
    function bindEvents() {
        $page.on("change", "#acd-company", function () {
            state.filters.company = $(this).val() || null;
            loadPageData();
        });

        $page.on("change", "#acd-period", function () {
            const preset = $(this).val();
            state.filters.period_preset = preset;

            if (preset === "custom") {
                $("#acd-date-from, #acd-date-to").prop("disabled", false).prop("readonly", false);
                $("#acd-apply-range").removeClass("hidden");
                clearDatePicker("#acd-date-from");
                clearDatePicker("#acd-date-to");
                return;
            }

            $("#acd-date-from, #acd-date-to").prop("disabled", true).prop("readonly", true);
            $("#acd-apply-range").addClass("hidden");
            state.filters.from_date = null;
            state.filters.to_date = null;
            loadPageData();
        });

        $page.on("click", "#acd-apply-range", function () {
            const from_date_display = $("#acd-date-from").val();
            const to_date_display = $("#acd-date-to").val();
            if (from_date_display && to_date_display) {
                state.filters.period_preset = "custom";
                state.filters.from_date = ddmmyyyyToIso(from_date_display);
                state.filters.to_date = ddmmyyyyToIso(to_date_display);
                loadPageData();
            } else {
                frappe.msgprint(__("Please select both from and to dates."));
            }
        });

        function ddmmyyyyToIso(value) {
            if (!value) return null;
            const parts = value.split("-");
            if (parts.length !== 3) return value;
            const [d, m, y] = parts;
            return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
        }

        $page.on("click", "#acd-refresh", () => loadPageData());
        $page.on("click", "#acd-theme-toggle", () => toggleTheme());

        $(document).on("keydown", function (e) {
            if (e.key === "Escape") closeAcdModal();
        });

        // Click on rows in modal to open form
        $page.on("click", ".acd-modal-row-clickable", function () {
            const pe = $(this).data("pe");
            const pi = $(this).data("pi");
            const docname = $(this).data("name");
            const doctype = $(this).data("doctype");
            const suppGroup = $(this).data("suppgroup");

            if (pe) {
                closeAcdModal();
                frappe.set_route("Form", "Payment Entry", pe);
            } else if (pi) {
                closeAcdModal();
                frappe.set_route("Form", "Purchase Invoice", pi);
            } else if (suppGroup) {
                closeAcdModal();
                openAgingPayablesReport(suppGroup);
            } else if (docname && doctype) {
                closeAcdModal();
                frappe.set_route("Form", doctype, docname);
            }
        });

        // Global functions for inline onclick handlers
        window.openAcdPendingApprovalList = openPendingApprovalList;
        window.openAcdTreasuryLedger = openTreasuryLedger;
        window.openAcdReceivablesReport = openReceivablesReport;
        window.openAcdAgingPayablesReport = openAgingPayablesReport;
        window.openAcdPendingPaymentEntriesModal = openPendingPaymentEntriesModal;
        window.openAcdPendingPurchaseInvoicesModal = openPendingPurchaseInvoicesModal;
        window.openAcdPaymentEntryList = openPaymentEntryList;
        window.openAcdPurchaseInvoiceList = openPurchaseInvoiceList;
        window.openAcdDrilldownModal = openDrilldownModal;
        window.setAcdAgingView = setAgingView;
        window.setAcdAgingSupplierGroup = setAgingSupplierGroup;
        window.toggleAgingPayablesView = toggleAgingPayablesView;
        window.closeAcdModal = closeAcdModal;
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
        $("#acd-date-from").datepicker(options);
        $("#acd-date-to").datepicker(options);
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
                }
            },
            error: function (err) {
                console.error("Accounts Dashboard: Failed to load data", err);
                showError();
            }
        });
    }

    function syncDateRangeInputs() {
        if (state.filters.period_preset === "custom") return;
        const pa = (state.data && state.data.pending_approvals) || {};
        if (pa.from_date) {
            const parts = pa.from_date.split("-");
            if (parts.length === 3) {
                $("#acd-date-from").val(`${parts[2]}-${parts[1]}-${parts[0]}`);
            } else {
                $("#acd-date-from").val(pa.from_date);
            }
        }
        if (pa.to_date) {
            const parts = pa.to_date.split("-");
            if (parts.length === 3) {
                $("#acd-date-to").val(`${parts[2]}-${parts[1]}-${parts[0]}`);
            } else {
                $("#acd-date-to").val(pa.to_date);
            }
        }
    }

    function showLoading() {
        $("#acd-content").html(shimmerBlock(450));
    }

    function showError() {
        $("#acd-content").html(`
            <div class="acd-error">
                <p>Failed to load dashboard data. Please try again.</p>
                <button class="acd-btn acd-btn-primary" onclick="location.reload()">Retry</button>
            </div>
        `);
    }

    // ============================================================
    // RENDER FUNCTION
    // ============================================================
    function render() {
        const d = state.data;
        if (!d) return;

        const $c = $("#acd-content");

        const getVal = (obj, key, fallback = "0") => {
            return obj && obj[key] !== undefined && obj[key] !== null ? obj[key] : fallback;
        };

        const pe = d.pending_payment_entries || {};
        const pi = d.pending_purchase_invoices || {};
        const isSupplierGroupView = state.agingView === "supplier_group";

        $c.html(`
            <div class="acd-bento">

                <!-- SECTION 1: PENDING APPROVALS (Payment Request, Expense Claim, Employee Advance) -->
                <div class="acd-bento-span-12 acd-card acd-anim" style="--delay:1;">
                    <div class="acd-card-label" style="margin-bottom:16px;">
                        ${iconSvg("check")} PENDING APPROVALS
                    </div>
                    <div class="acd-approval-grid">
                        ${renderPendingApprovalCards(d.pending_approvals)}
                    </div>
                </div>

                <!-- SECTION 2: DRAFT PAYMENT ENTRIES & DRAFT PURCHASE INVOICES -->
                <div class="acd-bento-span-6 acd-card acd-card-blob acd-anim is-clickable" style="--delay:2; cursor:pointer;" onclick="openAcdPendingPaymentEntriesModal()" title="Click to view Draft Payment Entries">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div>
                            <div class="acd-card-label">${iconSvg("dollar")} PAYMENT ENTRY PENDING</div>
                            <div class="acd-card-sub-label">STATUS = DRAFT</div>
                        </div>
                        <span class="acd-status-pill acd-pill-draft">Draft</span>
                    </div>
                    <div class="acd-card-draft-body">
                        <div class="acd-card-draft-count">${getVal(pe, "count", 0)}</div>
                        <div class="acd-card-draft-meta">
                            <span class="acd-stat-label">TOTAL AMOUNT</span>
                            <span class="acd-card-draft-amount">${getVal(pe, "total_amount_fmt", "₹ 0")}</span>
                        </div>
                    </div>
                    <button class="acd-card-action-btn" onclick="event.stopPropagation(); openAcdPaymentEntryList()">VIEW IN PAYMENT ENTRY LIST →</button>
                </div>

                <div class="acd-bento-span-6 acd-card acd-card-blob acd-anim is-clickable" style="--delay:3; cursor:pointer;" onclick="openAcdPendingPurchaseInvoicesModal()" title="Click to view Draft Purchase Invoices">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div>
                            <div class="acd-card-label">${iconSvg("file")} PURCHASE INVOICE PENDING</div>
                            <div class="acd-card-sub-label">STATUS = DRAFT</div>
                        </div>
                        <span class="acd-status-pill acd-pill-draft">Draft</span>
                    </div>
                    <div class="acd-card-draft-body">
                        <div class="acd-card-draft-count">${getVal(pi, "count", 0)}</div>
                        <div class="acd-card-draft-meta">
                            <span class="acd-stat-label">TOTAL AMOUNT</span>
                            <span class="acd-card-draft-amount">${getVal(pi, "total_amount_fmt", "₹ 0")}</span>
                        </div>
                    </div>
                    <button class="acd-card-action-btn" onclick="event.stopPropagation(); openAcdPurchaseInvoiceList()">VIEW IN PURCHASE INVOICE LIST →</button>
                </div>

                <!-- SECTION 3: FINANCIAL & COMPLIANCE PENDING (3 Cards) -->
                <div class="acd-bento-span-12" style="margin-top:4px;">
                    <div class="acd-card-label" style="margin-bottom:12px; font-size:13px;">
                        ${iconSvg("shield")} FINANCIAL & COMPLIANCE PENDING
                    </div>
                    <div class="acd-bento" style="gap:16px;">
                        ${renderFinancialCards(d.financial_compliance)}
                    </div>
                </div>

                <!-- SECTION 4: TREASURY BALANCES & RECEIVABLES (Currencies Only - No Total Base INR) -->
                <div class="acd-bento-span-6 acd-card acd-anim is-clickable" style="--delay:5; cursor:pointer;" onclick="openAcdTreasuryLedger()" title="Click to view General Ledger for Bank Accounts">
                    <div class="acd-card-label">${iconSvg("bank")} TREASURY BALANCES</div>
                    <div class="acd-currency-section">
                        <div class="acd-currency-grid">
                            ${renderCurrencyBalances(d.treasury)}
                        </div>
                    </div>
                </div>

                <div class="acd-bento-span-6 acd-card acd-anim is-clickable" style="--delay:6; cursor:pointer;" onclick="openAcdReceivablesReport()" title="Click to view Accounts Receivable report">
                    <div class="acd-card-label">${iconSvg("download")} RECEIVABLES</div>
                    <div class="acd-currency-section">
                        <div class="acd-currency-grid">
                            ${renderCurrencyBalances(d.receivables)}
                        </div>
                    </div>
                </div>

                <!-- SECTION 5: AGING PAYABLES -->
                <div class="acd-bento-span-12 acd-card acd-anim" style="--delay:7;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:10px;">
                        <div class="acd-card-label" style="margin-bottom:0;">
                            ${iconSvg("bar")} AGING PAYABLES ${state.agingView === 'supplier_group' ? '<span class="acd-badge-pill" style="margin-left:6px; background:#e0e7ff; color:#4338ca;">SUPPLIER GROUP WISE</span>' : ''}
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <button type="button" class="acd-card-view-all-btn ${state.agingView === 'overall' ? 'active' : ''}" onclick="setAcdAgingView('overall')" title="Overall Bar Chart (1-7, 8-15, 16-30, 31-45, 46-Above)">
                                ${iconSvg("bar", 12)} OVERALL CHART
                            </button>
                            <button type="button" class="acd-card-view-all-btn ${state.agingView === 'supplier_group' ? 'active' : ''}" onclick="setAcdAgingView('supplier_group')" title="Supplier Group on X-Axis and Aging Days on Y-Axis">
                                ${iconSvg("users", 12)} SUPPLIER GROUP WISE
                            </button>
                        </div>
                    </div>

                    <div id="acd-aging-container">
                        ${state.agingView === 'supplier_group' ? renderAgingSupplierGroupDistributionChart(d.aging_payables) : renderAgingNormalChart(d.aging_payables)}
                    </div>
                </div>

                <!-- SECTION 6: EBRC PENDING LIST (At the Last) -->
                <div class="acd-bento-span-12 acd-card acd-anim" style="--delay:8;">
                    <div class="acd-card-label" style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
                        <span>${iconSvg("file")} EBRC PENDING LIST</span>
                        <a href="javascript:void(0)" onclick="openAcdDrilldownModal('ebrc_all')" class="acd-link" style="color:var(--acd-primary); font-weight:800; font-size:12.5px; letter-spacing:0.6px; text-decoration:none; text-transform:uppercase;">VIEW ALL →</a>
                    </div>
                    <div class="acd-table-wrapper">
                        ${renderEbrcTable(d.ebrc_pending_list)}
                    </div>
                </div>

            </div>
        `);

        addTooltips();
    }

    // ============================================================
    // AGING PAYABLES VIEW TOGGLE & RENDERERS
    // ============================================================
    function setAgingView(view) {
        state.agingView = view;
        render();
    }

    function setAgingSupplierGroup(groupName) {
        if (state.selectedSupplierGroup === groupName) {
            state.selectedSupplierGroup = null;
        } else {
            state.selectedSupplierGroup = groupName;
        }
        render();
    }

    function toggleAgingPayablesView() {
        state.agingView = state.agingView === "overall" ? "supplier_group" : "overall";
        render();
    }

    function renderAgingNormalChart(data) {
        const groups = (data && data.by_supplier_group) || [];
        const rawItems = (data && data.items) || [];
        if (!groups.length && !rawItems.length) {
            return '<div style="padding:30px; text-align:center; color:var(--acd-text-3); font-weight:600;">No aging data available for this period.</div>';
        }

        const colorPalette = [
            "#6366f1", "#3b82f6", "#10b981", "#f59e0b",
            "#ec4899", "#8b5cf6", "#06b6d4", "#f97316",
            "#14b8a6", "#84cc16"
        ];

        const groupColorMap = {};
        groups.forEach((g, idx) => {
            groupColorMap[g.supplier_group] = colorPalette[idx % colorPalette.length];
        });

        const selectedGroup = state.selectedSupplierGroup
            ? groups.find(g => g.supplier_group === state.selectedSupplierGroup)
            : null;

        const bucketDefs = [
            { key: "day", label: "1-7", field: "day_raw", fmt_field: "day_fmt" },
            { key: "week", label: "8-15", field: "week_raw", fmt_field: "week_fmt" },
            { key: "month", label: "16-30", field: "month_raw", fmt_field: "month_fmt" },
            { key: "old30", label: "31-45", field: "old30_raw", fmt_field: "old30_fmt" },
            { key: "old45", label: "46-ABOVE", field: "old45_raw", fmt_field: "old45_fmt" },
        ];

        // Compute total and segments per bucket
        const bucketData = bucketDefs.map(b => {
            let total = 0;
            const segments = [];

            if (selectedGroup) {
                const val = selectedGroup[b.field] || 0;
                if (val > 0) {
                    total = val;
                    segments.push({
                        supplier_group: selectedGroup.supplier_group,
                        amount: val,
                        amount_fmt: selectedGroup[b.fmt_field] || fmtInrJs(val),
                        pct: 100,
                        color: groupColorMap[selectedGroup.supplier_group] || "#6366f1",
                    });
                }
            } else {
                groups.forEach(g => {
                    const val = g[b.field] || 0;
                    if (val > 0) {
                        total += val;
                    }
                });
                groups.forEach(g => {
                    const val = g[b.field] || 0;
                    if (val > 0) {
                        segments.push({
                            supplier_group: g.supplier_group,
                            amount: val,
                            amount_fmt: g[b.fmt_field] || fmtInrJs(val),
                            pct: total > 0 ? ((val / total) * 100).toFixed(1) : 0,
                            color: groupColorMap[g.supplier_group] || "#6366f1",
                        });
                    }
                });

                // Fallback if groups had 0 but rawItems had data
                const itemFallback = rawItems.find(it => it.key === b.key);
                if (total === 0 && itemFallback && itemFallback.raw_value > 0) {
                    total = itemFallback.raw_value;
                }
            }

            return {
                key: b.key,
                label: b.label,
                total: total,
                total_fmt: fmtInrJs(total),
                segments: segments,
            };
        });

        const maxVal = Math.max(...bucketData.map(b => b.total), 1);
        const displayTotalDue = selectedGroup ? (selectedGroup.total_fmt || fmtInrJs(selectedGroup.total || 0)) : (data.total_fmt || '₹ 0');
        const headerSubtitle = selectedGroup
            ? `Aging Distribution for <span style="color:${groupColorMap[selectedGroup.supplier_group] || 'var(--acd-primary)'}; font-weight:800;">${frappe.utils.escape_html(selectedGroup.supplier_group)}</span> (${selectedGroup.suppliers_count} Suppliers)`
            : `Overall Aging with Supplier Group Distribution`;

        return `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
                <span style="font-size:13px; font-weight:600; color:var(--acd-text-3);">${headerSubtitle}</span>
                <span style="font-size:16px; font-weight:800; color:var(--acd-text);">Total Due: ${displayTotalDue}</span>
            </div>

            <!-- SUPPLIER GROUP COLOR LEGEND & FILTER ON UPPER SIDE OF CHART -->
            ${groups.length ? `
                <div class="acd-supp-legend-wrap" style="margin-top:0; margin-bottom:14px; padding-top:0; border-top:none; padding-bottom:12px; border-bottom:1px solid var(--acd-border);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div style="font-size:11px; font-weight:700; color:var(--acd-text-3); text-transform:uppercase; letter-spacing:0.5px;">
                            Supplier Group Legend & Filter (${groups.length})
                        </div>
                        ${selectedGroup ? `
                            <a href="javascript:void(0)" onclick="setAcdAgingSupplierGroup(null)" style="font-size:11.5px; font-weight:700; color:var(--acd-primary); text-decoration:none; cursor:pointer;">
                                ✕ Reset to All Groups
                            </a>
                        ` : ''}
                    </div>
                    <div class="acd-supp-legend-grid">
                        <div class="acd-supp-legend-item ${!selectedGroup ? 'active' : ''}"
                             onclick="setAcdAgingSupplierGroup(null)"
                             style="cursor:pointer; ${!selectedGroup ? 'background:rgba(99, 102, 241, 0.12); border-color:var(--acd-primary); box-shadow:0 0 0 1.5px var(--acd-primary);' : ''}"
                             title="Click to show all supplier groups in chart"
                             data-tooltip="All Supplier Groups: ${data.total_fmt || '₹ 0'}">
                            <span class="acd-supp-legend-dot" style="background:var(--acd-primary, #6366f1);"></span>
                            <span class="acd-supp-legend-name" style="${!selectedGroup ? 'font-weight:700; color:var(--acd-primary);' : ''}">All Groups</span>
                            <strong class="acd-supp-legend-val">${data.total_fmt || '₹ 0'}</strong>
                        </div>
                        ${groups.map(g => {
                            const c = groupColorMap[g.supplier_group] || '#6366f1';
                            const isSelected = selectedGroup && selectedGroup.supplier_group === g.supplier_group;
                            return `
                                <div class="acd-supp-legend-item ${isSelected ? 'active' : ''}"
                                     onclick="setAcdAgingSupplierGroup('${frappe.utils.escape_html(g.supplier_group)}')"
                                     style="cursor:pointer; ${isSelected ? `background:${c}18; border-color:${c}; box-shadow:0 0 0 1.5px ${c};` : ''}"
                                     title="Click to filter chart by ${frappe.utils.escape_html(g.supplier_group)}"
                                     data-tooltip="${frappe.utils.escape_html(g.supplier_group)}: ${g.total_fmt} • ${g.suppliers_count} Suppliers">
                                    <span class="acd-supp-legend-dot" style="background:${c};"></span>
                                    <span class="acd-supp-legend-name" style="${isSelected ? `font-weight:700; color:${c};` : ''}">${frappe.utils.escape_html(g.supplier_group)}</span>
                                    <span class="acd-badge-pill" style="font-size:10px; padding:1px 5px;">${g.suppliers_count}</span>
                                    <strong class="acd-supp-legend-val">${g.total_fmt}</strong>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- BAR CHART CONTAINER -->
            <div class="acd-chart-container" style="height:210px; margin-bottom:8px;">
                <div class="acd-bar-chart" style="height:calc(100% - 32px); align-items:flex-end;">
                    ${bucketData.map((b) => {
                        const hasSegments = b.segments.length > 0;
                        const barHeightPct = Math.max(Math.round((b.total / maxVal) * 100), 6);
                        const isOld45 = b.key === "old45" && b.total > 0;
                        const isOld30 = b.key === "old30" && b.total > 0;
                        const valColor = (isOld45 || isOld30) ? "#dc2626" : "var(--acd-text-2)";
                        const labelColor = (isOld45 || isOld30) ? "#dc2626" : "var(--acd-text-3)";

                        const bucketTooltip = hasSegments
                            ? `${b.label} days (Total: ${b.total_fmt}): ` + b.segments.map(s => `${s.supplier_group}: ${s.amount_fmt}`).join(', ')
                            : `${b.label} days: ${b.total_fmt}`;

                        return `
                        <div class="acd-bar-item" style="justify-content:flex-end; flex:1;" data-tooltip="${bucketTooltip}">
                            <span class="acd-bar-value" style="color:${valColor}; font-weight:${b.total > 0 ? '800' : '600'}; font-size:11.5px;">${b.total_fmt}</span>
                            <div class="acd-bar acd-bar-stacked" style="height:${barHeightPct}%; width:100%; max-width:48px; border-radius:6px 6px 0 0; display:flex; flex-direction:column-reverse; overflow:hidden; background:${hasSegments ? 'transparent' : '#e5e7eb'}; box-shadow:0 2px 4px rgba(0,0,0,0.06);">
                                ${hasSegments ? b.segments.map(s => `
                                    <div class="acd-bar-segment"
                                         style="flex: 0 0 ${s.pct}%; height:${s.pct}%; min-height:3px; background:${s.color}; width:100%; cursor:pointer;"
                                         data-tooltip="${s.supplier_group} (${b.label} days): ${s.amount_fmt} (${s.pct}%)"
                                         onclick="event.stopPropagation(); openAcdAgingPayablesReport('${s.supplier_group}')"
                                         title="Click to view AP report for ${s.supplier_group}">
                                    </div>
                                `).join('') : ''}
                            </div>
                            <span class="acd-bar-label" style="color:${labelColor}; font-weight:700; margin-top:8px;">${b.label}</span>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function renderAgingSupplierGroupDistributionChart(data) {
        const groups = (data && data.by_supplier_group) || [];
        if (!groups.length) {
            return '<div style="padding:32px; text-align:center; color:var(--acd-text-3); font-weight:600;">No supplier group aging data available for this period.</div>';
        }

        const colorPalette = [
            "#6366f1", "#3b82f6", "#10b981", "#f59e0b",
            "#ec4899", "#8b5cf6", "#06b6d4", "#f97316",
            "#14b8a6", "#84cc16"
        ];

        const groupColorMap = {};
        groups.forEach((g, idx) => {
            groupColorMap[g.supplier_group] = colorPalette[idx % colorPalette.length];
        });

        const selectedGroup = state.selectedSupplierGroup
            ? groups.find(g => g.supplier_group === state.selectedSupplierGroup)
            : null;

        const visibleGroups = selectedGroup ? [selectedGroup] : groups;

        const bucketDefs = [
            { key: "day", label: "1-7 Days", field: "day_raw", fmt_field: "day_fmt" },
            { key: "week", label: "8-15 Days", field: "week_raw", fmt_field: "week_fmt" },
            { key: "month", label: "16-30 Days", field: "month_raw", fmt_field: "month_fmt" },
            { key: "old30", label: "31-45 Days", field: "old30_raw", fmt_field: "old30_fmt" },
            { key: "old45", label: "46-ABOVE", field: "old45_raw", fmt_field: "old45_fmt" },
        ];

        // Find max value for bar scaling across all visible groups and buckets
        let maxVal = 1;
        groups.forEach(g => {
            bucketDefs.forEach(b => {
                const val = g[b.field] || 0;
                if (val > maxVal) maxVal = val;
            });
        });

        const displayTotalDue = selectedGroup
            ? (selectedGroup.total_fmt || fmtInrJs(selectedGroup.total || 0))
            : (data.total_fmt || '₹ 0');

        const headerSubtitle = selectedGroup
            ? `Supplier Group Aging: <span style="color:${groupColorMap[selectedGroup.supplier_group] || 'var(--acd-primary)'}; font-weight:800;">${frappe.utils.escape_html(selectedGroup.supplier_group)}</span> (${selectedGroup.suppliers_count} Suppliers)`
            : `Supplier Group Wise Aging Distribution (${groups.length} Groups across 5 Aging Buckets)`;

        return `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
                <span style="font-size:13px; font-weight:600; color:var(--acd-text-3);">${headerSubtitle}</span>
                <span style="font-size:16px; font-weight:800; color:var(--acd-text);">Total Due: ${displayTotalDue}</span>
            </div>

            <!-- SUPPLIER GROUP COLOR LEGEND & FILTER ON UPPER SIDE -->
            ${groups.length ? `
                <div class="acd-supp-legend-wrap" style="margin-top:0; margin-bottom:16px; padding-top:0; border-top:none; padding-bottom:12px; border-bottom:1px solid var(--acd-border);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div style="font-size:11px; font-weight:700; color:var(--acd-text-3); text-transform:uppercase; letter-spacing:0.5px;">
                            Supplier Group Legend (${groups.length})
                        </div>
                        ${selectedGroup ? `
                            <a href="javascript:void(0)" onclick="setAcdAgingSupplierGroup(null)" style="font-size:11.5px; font-weight:700; color:var(--acd-primary); text-decoration:none; cursor:pointer;">
                                ✕ Reset to All Groups
                            </a>
                        ` : ''}
                    </div>
                    <div class="acd-supp-legend-grid">
                        <div class="acd-supp-legend-item ${!selectedGroup ? 'active' : ''}"
                             onclick="setAcdAgingSupplierGroup(null)"
                             style="cursor:pointer; ${!selectedGroup ? 'background:rgba(99, 102, 241, 0.12); border-color:var(--acd-primary); box-shadow:0 0 0 1.5px var(--acd-primary);' : ''}"
                             title="Show all supplier groups in chart"
                             data-tooltip="All Supplier Groups: ${data.total_fmt || '₹ 0'}">
                            <span class="acd-supp-legend-dot" style="background:var(--acd-primary, #6366f1);"></span>
                            <span class="acd-supp-legend-name" style="${!selectedGroup ? 'font-weight:700; color:var(--acd-primary);' : ''}">All Groups</span>
                            <strong class="acd-supp-legend-val">${data.total_fmt || '₹ 0'}</strong>
                        </div>
                        ${groups.map(g => {
                            const c = groupColorMap[g.supplier_group] || '#6366f1';
                            const isSelected = selectedGroup && selectedGroup.supplier_group === g.supplier_group;
                            return `
                                <div class="acd-supp-legend-item ${isSelected ? 'active' : ''}"
                                     onclick="setAcdAgingSupplierGroup('${frappe.utils.escape_html(g.supplier_group)}')"
                                     style="cursor:pointer; ${isSelected ? `background:${c}18; border-color:${c}; box-shadow:0 0 0 1.5px ${c};` : ''}"
                                     title="Click to filter chart by ${frappe.utils.escape_html(g.supplier_group)}"
                                     data-tooltip="${frappe.utils.escape_html(g.supplier_group)}: ${g.total_fmt} • ${g.suppliers_count} Suppliers">
                                    <span class="acd-supp-legend-dot" style="background:${c};"></span>
                                    <span class="acd-supp-legend-name" style="${isSelected ? `font-weight:700; color:${c};` : ''}">${frappe.utils.escape_html(g.supplier_group)}</span>
                                    <span class="acd-badge-pill" style="font-size:10px; padding:1px 5px;">${g.suppliers_count}</span>
                                    <strong class="acd-supp-legend-val">${g.total_fmt}</strong>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- GROUPED BAR CHART: X-AXIS = AGING BUCKETS, EACH BUCKET SHOWS ALL SUPPLIER GROUP BARS -->
            <div class="acd-chart-container" style="height:230px; margin-bottom:12px; overflow-x:auto;">
                <div style="display:flex; justify-content:space-evenly; align-items:flex-end; height:calc(100% - 32px); gap:12px; padding:0 8px; max-width:960px; margin:0 auto;">
                    ${bucketDefs.map(b => {
                        let bucketTotal = 0;
                        visibleGroups.forEach(g => {
                            bucketTotal += (g[b.field] || 0);
                        });

                        const isCritical = (b.key === "old30" || b.key === "old45") && bucketTotal > 0;
                        const headerColor = isCritical ? "#dc2626" : "var(--acd-text-2)";

                        return `
                        <div style="display:flex; flex-direction:column; align-items:center; justify-content:flex-end; flex:1; height:100%; max-width:180px; min-width:120px; border-bottom:2px solid var(--acd-border); padding-bottom:8px;">
                            <!-- Bucket Total Value on Top -->
                            <span style="font-size:11.5px; font-weight:800; color:${headerColor}; margin-bottom:8px; white-space:nowrap;">
                                ${fmtInrJs(bucketTotal)}
                            </span>

                            <!-- Cluster of Supplier Group Bars -->
                            <div style="display:flex; align-items:flex-end; justify-content:center; gap:4px; width:100%; height:145px;">
                                ${visibleGroups.map(g => {
                                    const val = g[b.field] || 0;
                                    const c = groupColorMap[g.supplier_group] || '#6366f1';
                                    const barHeightPct = val > 0 ? Math.max(Math.round((val / maxVal) * 100), 6) : 0;
                                    const fmtVal = g[b.fmt_field] || fmtInrJs(val);
                                    const barWidth = visibleGroups.length === 1 ? 48 : Math.max(Math.min(Math.floor(130 / visibleGroups.length), 22), 14);

                                    return `
                                    <div style="height:${val > 0 ? barHeightPct + '%' : '2px'}; width:${barWidth}px; max-width:26px; min-width:12px; background:${val > 0 ? c : 'rgba(148, 163, 184, 0.16)'}; border-radius:${val > 0 ? '4px 4px 0 0' : '2px'}; cursor:${val > 0 ? 'pointer' : 'default'}; transition:all 0.2s cubic-bezier(0.4, 0, 0.2, 1); box-shadow:${val > 0 ? '0 2px 5px rgba(0,0,0,0.1)' : 'none'};"
                                         data-tooltip="${frappe.utils.escape_html(g.supplier_group)} • ${b.label}: ${fmtVal}"
                                         title="${frappe.utils.escape_html(g.supplier_group)} • ${b.label}: ${fmtVal}"
                                         onclick="event.stopPropagation(); openAcdAgingPayablesReport('${frappe.utils.escape_html(g.supplier_group)}')">
                                    </div>
                                    `;
                                }).join('')}
                            </div>

                            <!-- Bucket Label at Bottom of X-Axis -->
                            <div style="margin-top:10px; text-align:center;">
                                <span style="font-size:11.5px; font-weight:700; color:${isCritical ? '#dc2626' : 'var(--acd-text)'}; letter-spacing:0.3px;">
                                    ${b.label}
                                </span>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function fmtInrJs(val) {
        if (!val) return "₹ 0";
        const abs = Math.abs(val);
        if (abs >= 1e7) return "₹ " + (val / 1e7).toFixed(2) + " Cr";
        if (abs >= 1e5) return "₹ " + (val / 1e5).toFixed(2) + " L";
        return "₹ " + Math.round(val).toLocaleString("en-IN");
    }

    // ============================================================
    // RENDER HELPERS
    // ============================================================

    function renderPendingApprovalCards(pendingApprovals) {
        const items = (pendingApprovals && pendingApprovals.items) || [];
        if (!items.length) return '<div class="acd-approval-card">No data</div>';

        const meta = {
            payment_request:   { icon: "dollar",   color: "#0891b2", bg: "#ecfeff" },
            expense_claim:     { icon: "file",     color: "#d97706", bg: "#fffbeb" },
            employee_advance:  { icon: "bank",     color: "#10b981", bg: "#ecfdf5" },
        };

        return items.map(item => {
            const m = meta[item.key] || { icon: "file", color: "#6366f1", bg: "#eef2ff" };
            return `
            <div class="acd-approval-card is-clickable" onclick="openAcdPendingApprovalList('${item.key}')" title="Click to view ${item.label}">
                <div class="acd-approval-icon" style="background:${m.bg}; color:${m.color};">${iconSvg(m.icon, 20)}</div>
                <div class="acd-approval-info">
                    <div class="acd-approval-value">${item.count || 0}</div>
                    <div class="acd-approval-label">${item.label}</div>
                </div>
            </div>`;
        }).join('');
    }

    function renderFinancialCards(fc) {
        if (!fc) return "";
        const keys = ["pending_drawback", "pending_igst", "rodtep_pending"];
        return keys.map((k, idx) => {
            const c = fc[k];
            if (!c) return "";
            return `
                <div class="acd-bento-span-4 acd-card is-clickable acd-anim" style="--delay:${idx + 4}; border-left:4px solid ${c.color}; cursor:pointer;" onclick="openAcdDrilldownModal('${k}')" title="Click to view details for ${c.title}">
                    <div class="acd-card-header-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px;">
                        <div class="acd-card-label" style="margin-bottom:0; color:${c.color}; font-size:12px;">
                            ${iconSvg(c.icon || "shield", 14)} ${c.title}
                        </div>
                        <button type="button" class="acd-card-view-all-btn" onclick="event.stopPropagation(); openAcdDrilldownModal('${k}')" title="View details for ${c.title}">
                            <span>VIEW ALL</span>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:8px;">
                        <div>
                            <div style="font-size:32px; font-weight:900; color:var(--acd-text); line-height:1;">${c.count}</div>
                            <div style="font-size:11.5px; font-weight:600; color:var(--acd-text-3); margin-top:4px;">${c.count_label}</div>
                        </div>
                        ${c.value ? `
                            <div style="text-align:right;">
                                <div style="font-size:22px; font-weight:900; color:#10b981; line-height:1;">${c.value}</div>
                                <div style="font-size:11px; font-weight:700; color:var(--acd-text-3); text-transform:uppercase; margin-top:4px;">${c.value_label}</div>
                            </div>
                        ` : ""}
                    </div>
                </div>
            `;
        }).join("");
    }

    function renderEbrcTable(rows) {
        if (!rows || !rows.length) {
            return `<div style="padding:28px; text-align:center; color:var(--acd-text-3); font-weight:600;">No draft BRC Management records found.</div>`;
        }

        let bodyRows = rows.map(r => {
            return `
                <tr class="acd-table-row acd-brc-row" data-name="${r.name}" style="cursor:pointer;" onclick="frappe.set_route('Form', 'BRC Management', '${r.name}')" title="Click to open ${r.name}">
                    <td><strong style="color:var(--acd-primary); font-weight:700;">${r.name}</strong></td>
                    <td><strong style="color:var(--acd-text); font-weight:700;">${r.invoice_no}</strong></td>
                    <td style="color:var(--acd-text-2);">${r.date}</td>
                    <td style="color:var(--acd-text); font-weight:600;">${r.customer}</td>
                    <td><span class="acd-badge-pill">${r.currency}</span></td>
                    <td><strong style="color:var(--acd-text); font-weight:800;">${r.value}</strong></td>
                </tr>
            `;
        }).join("");

        return `
            <table class="acd-data-table">
                <thead>
                    <tr>
                        <th>BRC NO</th>
                        <th>INVOICE NO</th>
                        <th>DATE</th>
                        <th>CUSTOMER</th>
                        <th>CURRENCY</th>
                        <th>VALUE</th>
                    </tr>
                </thead>
                <tbody>
                    ${bodyRows}
                </tbody>
            </table>
        `;
    }

    function renderCurrencyBalances(data) {
        const items = (data && data.currencies) || [];
        if (!items.length) {
            return `<div style="grid-column:1/-1;font-size:13px;color:var(--acd-text-3);text-align:center;padding:16px 0;">No currency balances found</div>`;
        }
        return items.map(it => `
            <div class="acd-currency-box">
                <span class="acd-currency-label">${it.currency || ''}</span>
                <span class="acd-currency-value">${it.balance_fmt || ''}</span>
            </div>
        `).join('');
    }



    // ============================================================
    // MODALS & NAVIGATION
    // ============================================================

    function openPendingApprovalList(key) {
        const pa = (state.data && state.data.pending_approvals) || {};
        const item = (pa.items || []).find(i => i.key === key);
        if (!item) {
            frappe.msgprint(__("No data available for this section."));
            return;
        }

        const routeOptions = { docstatus: 0 };

        if (item.date_field) {
            routeOptions[item.date_field] = ["between", [pa.from_date, pa.to_date]];
        }
        if (state.filters.company) {
            routeOptions.company = state.filters.company;
        }
        if (item.has_workflow) {
            routeOptions.workflow_state = ["not in", ["Draft"]];
        }

        frappe.route_options = routeOptions;
        frappe.set_route("List", item.doctype);
    }

    function openTreasuryLedger() {
        const treasury = (state.data && state.data.treasury) || {};
        const accounts = (treasury.accounts || []).map(a => a.account);

        if (!accounts.length) {
            frappe.msgprint(__("No bank accounts found for the selected filters."));
            return;
        }

        frappe.route_options = {
            from_date: treasury.from_date || state.filters.from_date,
            to_date: treasury.as_of_date || state.filters.to_date,
            account: accounts,
        };
        if (state.filters.company) {
            frappe.route_options.company = state.filters.company;
        }
        frappe.set_route("query-report", "General Ledger");
    }

    function openReceivablesReport() {
        const rec = (state.data && state.data.receivables) || {};
        frappe.route_options = {
            report_date: rec.as_of_date || state.filters.to_date,
        };
        if (state.filters.company) {
            frappe.route_options.company = state.filters.company;
        }
        frappe.set_route("query-report", "Accounts Receivable");
    }

    function patchAgingRangeOnload(range) {
        const reportSettings = frappe.query_reports && frappe.query_reports["Accounts Payable Summary"];
        if (!reportSettings || reportSettings.__acd_range_patched) return false;
        const originalOnload = reportSettings.onload;
        reportSettings.onload = function (report) {
            if (originalOnload) originalOnload.call(this, report);
            report.set_filter_value("range", range);
        };
        reportSettings.__acd_range_patched = true;
        return true;
    }

    function enforceAgingRange(range, retriesLeft) {
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

    function openAgingPayablesReport(supplierGroup) {
        const range = "7,15,30,45";
        const reportDate = state.filters.to_date || frappe.datetime.nowdate();
        const routeOptions = {
            party_type: "Supplier",
            report_date: reportDate,
            range: range,
            ageing_based_on: "Due Date",
        };
        if (state.filters.company) {
            routeOptions.company = state.filters.company;
        }
        if (supplierGroup && supplierGroup !== "All Other Suppliers") {
            routeOptions.supplier_group = [supplierGroup];
        }

        patchAgingRangeOnload(range);
        frappe.route_options = routeOptions;
        frappe.set_route("query-report", "Accounts Payable Summary").then(() => {
            enforceAgingFilters(range, supplierGroup, reportDate, 10);
        });
    }

    function enforceAgingFilters(range, supplierGroup, reportDate, retriesLeft) {
        patchAgingRangeOnload(range);
        const report = frappe.query_report;
        if (report && report.report_name === "Accounts Payable Summary") {
            let needsRefresh = false;
            if (report.get_filter_value("range") !== range) {
                report.set_filter_value("range", range);
                needsRefresh = true;
            }
            if (supplierGroup && supplierGroup !== "All Other Suppliers") {
                const currentGroup = report.get_filter_value("supplier_group");
                const targetVal = Array.isArray(currentGroup) ? [supplierGroup] : [supplierGroup];
                if (!currentGroup || !currentGroup.length || currentGroup[0] !== supplierGroup) {
                    report.set_filter_value("supplier_group", targetVal);
                    needsRefresh = true;
                }
            }
            if (reportDate && report.get_filter_value("report_date") !== reportDate) {
                report.set_filter_value("report_date", reportDate);
                needsRefresh = true;
            }
            if (state.filters.company && report.get_filter_value("company") !== state.filters.company) {
                report.set_filter_value("company", state.filters.company);
                needsRefresh = true;
            }
            if (needsRefresh) {
                report.refresh();
            }
        }
        if (retriesLeft > 0) {
            setTimeout(() => enforceAgingFilters(range, supplierGroup, reportDate, retriesLeft - 1), 250);
        }
    }

    function openPaymentEntryList() {
        const pe = (state.data && state.data.pending_payment_entries) || {};
        const routeOptions = {
            docstatus: 0,
        };
        if (pe.from_date && pe.to_date) {
            routeOptions.posting_date = ["between", [pe.from_date, pe.to_date]];
        }
        if (state.filters.company) {
            routeOptions.company = state.filters.company;
        }
        frappe.route_options = routeOptions;
        frappe.set_route("List", "Payment Entry");
    }

    function openPurchaseInvoiceList() {
        const pi = (state.data && state.data.pending_purchase_invoices) || {};
        const routeOptions = {
            docstatus: 0,
        };
        if (pi.from_date && pi.to_date) {
            routeOptions.posting_date = ["between", [pi.from_date, pi.to_date]];
        }
        if (state.filters.company) {
            routeOptions.company = state.filters.company;
        }
        frappe.route_options = routeOptions;
        frappe.set_route("List", "Purchase Invoice");
    }

    function openPendingPaymentEntriesModal() {
        const pe = (state.data && state.data.pending_payment_entries) || {};
        const items = pe.items || [];

        $("#acd-modal-title").text("Payment Entry Pending (Draft)");
        setModalSubtitle(periodSubtitle(pe.from_date, pe.to_date));
        setModalStats(items.length, "DRAFT PAYMENT ENTRIES", `<button class="acd-modal-view-btn" onclick="openAcdPaymentEntryList()">Open List View →</button>`);

        const $table = $("#acd-modal-table");
        $table.find("thead").html(`
            <tr>
                <th>#</th>
                <th>Name</th>
                <th>Type</th>
                <th>Party</th>
                <th>Date</th>
                <th style="text-align:right;">Amount</th>
                <th>Status</th>
            </tr>
        `);

        if (!items.length) {
            $table.find("tbody").html(`<tr><td colspan="7" style="text-align:center;padding:24px;">No draft payment entries found.</td></tr>`);
        } else {
            const rows = items.map((item, i) => `
                <tr class="acd-modal-row-clickable" data-pe="${item.name}">
                    <td>${i + 1}</td>
                    <td class="acd-modal-key">${item.name}</td>
                    <td>${item.payment_type || ''}</td>
                    <td>${item.party_display || ''}</td>
                    <td>${item.posting_date || ''}</td>
                    <td class="acd-modal-amount">${item.amount_fmt || ''}</td>
                    <td><span class="acd-status-pill acd-pill-draft">${item.status}</span></td>
                </tr>
            `).join("");
            $table.find("tbody").html(rows);
        }

        $("#acd-modal").removeClass("hidden");
    }

    function openPendingPurchaseInvoicesModal() {
        const pi = (state.data && state.data.pending_purchase_invoices) || {};
        const items = pi.items || [];

        $("#acd-modal-title").text("Purchase Invoice Pending (Draft)");
        setModalSubtitle(periodSubtitle(pi.from_date, pi.to_date));
        setModalStats(items.length, "DRAFT PURCHASE INVOICES", `<button class="acd-modal-view-btn" onclick="openAcdPurchaseInvoiceList()">Open List View →</button>`);

        const $table = $("#acd-modal-table");
        $table.find("thead").html(`
            <tr>
                <th>#</th>
                <th>Invoice</th>
                <th>Supplier</th>
                <th>Bill No</th>
                <th>Date</th>
                <th style="text-align:right;">Grand Total</th>
                <th>Status</th>
            </tr>
        `);

        if (!items.length) {
            $table.find("tbody").html(`<tr><td colspan="7" style="text-align:center;padding:24px;">No draft purchase invoices found.</td></tr>`);
        } else {
            const rows = items.map((item, i) => `
                <tr class="acd-modal-row-clickable" data-pi="${item.name}">
                    <td>${i + 1}</td>
                    <td class="acd-modal-key">${item.name}</td>
                    <td>${item.supplier_display || ''}</td>
                    <td>${item.bill_no || '-'}</td>
                    <td>${item.posting_date || ''}</td>
                    <td class="acd-modal-amount">${item.amount_fmt || ''}</td>
                    <td><span class="acd-status-pill acd-pill-draft">${item.status}</span></td>
                </tr>
            `).join("");
            $table.find("tbody").html(rows);
        }

        $("#acd-modal").removeClass("hidden");
    }

    function openDrilldownModal(cardKey) {
        $("#acd-modal").removeClass("hidden");
        $("#acd-modal-title").text("Loading Details...");
        $("#acd-modal-subtitle").text("Please wait");
        $("#acd-modal-stats").hide();
        $("#acd-modal-table thead").empty();
        $("#acd-modal-table tbody").html(`<tr><td colspan="6" style="text-align:center; padding:30px;">${shimmerBlock(120)}</td></tr>`);

        frappe.call({
            method: methodRoot + "get_modal_drilldown",
            args: {
                card_key: cardKey,
                period_preset: state.filters.period_preset,
                company: state.filters.company,
                from_date: state.filters.from_date,
                to_date: state.filters.to_date,
            },
            callback: function (r) {
                if (r && r.message) {
                    const m = r.message;
                    $("#acd-modal-title").text(m.title || "Document Details");
                    setModalSubtitle(m.subtitle || "");

                    let actionBtn = "";
                    if (m.doctype && m.doctype !== "Supplier Group") {
                        actionBtn = `<button class="acd-modal-view-btn" onclick="frappe.set_route('List', '${m.doctype}')">Open ${m.doctype} List →</button>`;
                    } else if (m.card_key === "aging_supplier_groups") {
                        actionBtn = `<button class="acd-modal-view-btn" onclick="openAcdAgingPayablesReport()">Open Full AP Report →</button>`;
                    }
                    setModalStats((m.rows || []).length, "RECORDS", actionBtn);

                    let head = "<tr>";
                    (m.columns || []).forEach(c => { head += `<th>${c}</th>`; });
                    head += "</tr>";
                    $("#acd-modal-table thead").html(head);

                    let body = "";
                    if (m.rows && m.rows.length) {
                        const doctype = m.doctype || "Sales Invoice";
                        m.rows.forEach(row => {
                            const docname = row[0];
                            const suppGroupAttr = m.card_key === "aging_supplier_groups" ? `data-suppgroup="${docname}"` : "";
                            body += `<tr class="acd-modal-row-clickable" data-name="${docname}" data-doctype="${doctype}" ${suppGroupAttr} style="cursor:pointer;" title="Click to open details">`;
                            row.forEach((cell, idx) => {
                                if (idx === 0) {
                                    body += `<td><strong style="color:var(--acd-primary);">${cell}</strong></td>`;
                                } else if (idx === row.length - 1 && (String(cell).includes("₹") || String(cell).includes("$") || String(cell).includes("€"))) {
                                    body += `<td style="font-weight:800; text-align:right;">${cell}</td>`;
                                } else if (String(cell).includes("₹") || String(cell).includes("$") || String(cell).includes("€")) {
                                    body += `<td style="font-weight:600;">${cell}</td>`;
                                } else {
                                    body += `<td>${cell}</td>`;
                                }
                            });
                            body += "</tr>";
                        });
                    } else {
                        body = `<tr><td colspan="${(m.columns && m.columns.length) || 6}" style="text-align:center; padding:24px;">No records found.</td></tr>`;
                    }
                    $("#acd-modal-table tbody").html(body);
                }
            }
        });
    }

    function closeAcdModal() {
        $("#acd-modal").addClass("hidden");
    }

    function setModalSubtitle(text) {
        $("#acd-modal-subtitle").text(text || "");
    }

    function setModalStats(count, label, actionHtml) {
        const $stats = $("#acd-modal-stats");
        if (count === null || count === undefined) {
            $stats.hide().empty();
            return;
        }
        $stats.show().html(`
            <div class="acd-modal-stats-main">
                <div class="acd-modal-stats-value">${count}</div>
                <div class="acd-modal-stats-label">${label || 'TOTAL RECORDS'}</div>
            </div>
            ${actionHtml ? `<div style="margin-left:auto;">${actionHtml}</div>` : ''}
        `);
    }

    function periodSubtitle(fromDate, toDate) {
        const f = fromDate || state.filters.from_date;
        const t = toDate || state.filters.to_date;
        return (f && t) ? `${frappe.datetime.str_to_user(f)} - ${frappe.datetime.str_to_user(t)}` : '';
    }

    // ============================================================
    // TOOLTIPS
    // ============================================================
    function addTooltips() {
        const $tooltip = $('<div id="acd-tooltip" class="acd-tooltip"></div>');
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
    // ICONS (SVG)
    // ============================================================
    function iconSvg(name, size) {
        const I = {
            home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
            calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
            refresh: '<path d="M21 12a9 9 0 11-9-9c2.5 0 4.7 1 6.4 2.6L21 8M21 3v5h-5"/>',
            file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
            bank: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
            download: '<line x1="12" y1="2" x2="12" y2="15"/><polyline points="19 8 12 15 5 8"/><line x1="2" y1="20" x2="22" y2="20"/>',
            bar: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
            dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
            check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
            sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
            moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
            shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
            percent: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
            claim: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
            users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
            table: '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>',
        };
        const s = size || 16;
        return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;">${I[name] || ""}</svg>`;
    }

    // ============================================================
    // STYLES
    // ============================================================
    function injectStyles() {
        if ($("#acd-style").length) return;
        $("head").append(`
<style id="acd-style">
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

.acd-page {
    --acd-bg: #f3f4f6;
    --acd-surface: #ffffff;
    --acd-border: #e5e7eb;
    --acd-text: #111827;
    --acd-text-2: #374151;
    --acd-text-3: #6b7280;
    --acd-primary: #6366f1;
    --acd-primary-dark: #4f46e5;
    background: var(--acd-bg);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    padding: 0;
    margin: 0;
    min-height: 100vh;
    transition: background .2s ease;
    -webkit-font-smoothing: antialiased;
}
.acd-page * { box-sizing: border-box; }

.acd-page[data-theme="dark"] {
    --acd-bg: #14161f;
    --acd-surface: #1c1f2b;
    --acd-border: #2c2f3d;
    --acd-text: #f3f4f6;
    --acd-text-2: #cbd0dc;
    --acd-text-3: #8b8fa3;
}
.acd-page[data-theme="dark"] .acd-shimmer {
    background: linear-gradient(90deg, #1c1f2b 25%, #262a38 50%, #1c1f2b 75%);
    background-size: 200% 100%;
}
.acd-page[data-theme="dark"] #acd-content::-webkit-scrollbar-thumb { background: #3a3f52; }
.acd-page[data-theme="dark"] #acd-content::-webkit-scrollbar-thumb:hover { background: #4b5169; }
.acd-page[data-theme="dark"] .acd-card:hover { border-color: #3a3f52; }
.acd-page[data-theme="dark"] .acd-currency-box { background: #14161f; border-color: #2c2f3d; }
.acd-page[data-theme="dark"] .acd-currency-box:hover { background: #262a45; border-color: #3f4570; }
.acd-page[data-theme="dark"] .acd-tooltip { background: rgba(255,255,255,0.95); color: #111827; }
.acd-page[data-theme="dark"] .acd-card-action-btn { background: #262a3e; color: #a5b4fc; }
.acd-page[data-theme="dark"] .acd-card-action-btn:hover { background: var(--acd-primary); color: #fff; }
.acd-page[data-theme="dark"] .acd-data-table th { background: #1c1f2b; border-color: #2c2f3d; }
.acd-page[data-theme="dark"] .acd-data-table td { border-color: #2c2f3d; }
.acd-page[data-theme="dark"] .acd-data-table tbody tr:hover td { background: #262a3e; }
.acd-page[data-theme="dark"] .acd-card-view-all-btn { background: #262a3e; color: #a5b4fc; }
.acd-page[data-theme="dark"] .acd-card-view-all-btn:hover { background: var(--acd-primary); color: #fff; }
.acd-page[data-theme="dark"] .acd-card-view-all-btn.active { background: var(--acd-primary) !important; color: #fff !important; }
.acd-page[data-theme="dark"] .acd-supp-chart-row { background: #1c1f2b; border-color: #2c2f3d; }
.acd-page[data-theme="dark"] .acd-supp-chart-row:hover { border-color: var(--acd-primary); background: #232738; }
.acd-page[data-theme="dark"] .acd-supp-bar-track { background: #2c2f3d; }
.acd-page[data-theme="dark"] .acd-supp-legend-item { background: #1c1f2b; border-color: #2c2f3d; }
.acd-page[data-theme="dark"] .acd-supp-legend-item:hover { background: #25293d; border-color: var(--acd-primary); }

.acd-shell {
    max-width: 100%;
    margin: 0;
    padding: 16px 24px 32px 24px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
}

/* Filter Bar */
.acd-filter-bar {
    background: var(--acd-surface);
    border: 1px solid var(--acd-border);
    border-radius: 12px;
    padding: 12px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    margin-bottom: 16px;
    flex-shrink: 0;
}
.acd-field { position: relative; display: flex; align-items: center; }
.acd-field-icon svg { position: absolute; left: 14px; color: var(--acd-text-3); pointer-events: none; }
.acd-field select {
    border: 1px solid var(--acd-border);
    border-radius: 8px;
    padding: 8px 16px 8px 38px;
    font-size: 15px;
    font-weight: 600;
    color: var(--acd-text);
    background: var(--acd-bg);
    height: 40px;
    outline: none;
    appearance: none;
    cursor: pointer;
    min-width: 170px;
    transition: background .15s ease, border-color .15s ease;
}
.acd-field select:hover { background: var(--acd-surface); border-color: var(--acd-primary); }
.acd-custom-range { display: flex; align-items: center; gap: 10px; }
.acd-custom-range.hidden, .acd-custom-range .hidden { display: none; }
.acd-custom-range span { font-size: 14px; color: var(--acd-text-3); font-weight: 600; }
.acd-date-input {
    padding: 8px 12px;
    border: 1px solid var(--acd-border);
    border-radius: 6px;
    background: var(--acd-surface);
    font-size: 14.5px;
    font-weight: 600;
    color: var(--acd-text);
    outline: none;
    height: 40px;
    min-width: 140px;
    transition: border-color .15s ease, background .15s ease;
}
.acd-date-input:not(:disabled) { cursor: pointer; }
.acd-date-input:not(:disabled):hover { border-color: var(--acd-primary); }
.acd-date-input:focus { border-color: var(--acd-primary); }
.acd-date-input:disabled {
    background: var(--acd-bg);
    color: var(--acd-text-3);
    font-weight: 600;
    cursor: default;
    opacity: 1;
}

.acd-filter-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.acd-icon-btn {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    border: 1px solid var(--acd-border);
    background: var(--acd-surface);
    color: var(--acd-text-2);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all .2s ease;
}
.acd-icon-btn:hover { background: var(--acd-bg); border-color: var(--acd-primary); color: var(--acd-primary); }
.acd-btn {
    padding: 4px 16px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 700;
    border: none;
    cursor: pointer;
    transition: all .2s ease;
}
.acd-btn-primary { background: var(--acd-primary); color: #fff; }
.acd-btn-primary:hover { background: var(--acd-primary-dark); }
#acd-apply-range {
    height: 40px;
    padding: 0 20px;
    font-size: 14.5px;
    background: var(--acd-text);
    color: var(--acd-bg);
}
#acd-apply-range:hover { opacity: 0.85; }

/* Bento Grid */
.acd-bento {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 20px;
}
.acd-bento-span-4 { grid-column: span 4; }
.acd-bento-span-6 { grid-column: span 6; }
.acd-bento-span-12 { grid-column: span 12; }

/* Animation */
.acd-anim {
    opacity: 0;
    animation: acd-slide-up .4s cubic-bezier(.16,1,.3,1) forwards;
    animation-delay: calc(var(--delay, 0) * 0.05s);
}
@keyframes acd-slide-up {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
}

/* Cards */
.acd-card {
    position: relative;
    background: var(--acd-surface);
    border-radius: 16px;
    padding: 22px 24px;
    border: 1px solid var(--acd-border);
    box-shadow: 0 1px 2px rgba(16,24,40,0.04), 0 4px 12px -4px rgba(16,24,40,0.06);
    overflow: hidden;
    transition: transform .25s cubic-bezier(.16,1,.3,1), box-shadow .25s ease, border-color .25s ease;
    display: flex;
    flex-direction: column;
}
.acd-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 2px 4px rgba(16,24,40,0.05), 0 12px 24px -8px rgba(16,24,40,0.12);
    border-color: #dfe3ea;
}
.acd-card-blob::before {
    content: "";
    position: absolute;
    top: -70px;
    right: -70px;
    width: 180px;
    height: 180px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(99,102,241,0.08), rgba(99,102,241,0) 70%);
    pointer-events: none;
    z-index: 0;
}
.acd-card > * { position: relative; z-index: 1; }
.acd-card-label {
    font-size: 12px;
    font-weight: 800;
    color: var(--acd-text-3);
    letter-spacing: 0.7px;
    text-transform: uppercase;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
}
.acd-card-label svg { width: 14px; height: 14px; color: var(--acd-primary); flex-shrink: 0; }
.acd-card-sub-label {
    font-size: 11px;
    font-weight: 700;
    color: #d97706;
    letter-spacing: 0.5px;
    text-transform: uppercase;
}

/* Card View All Mini Button */
.acd-card-view-all-btn {
    display: inline-flex;
    align-items: center;
    background: #eef2ff;
    color: var(--acd-primary);
    border: none;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.4px;
    cursor: pointer;
    transition: all .15s ease;
}
.acd-card-view-all-btn:hover {
    background: var(--acd-primary);
    color: #fff;
}
.acd-btn-aging-toggle {
    background: #e0e7ff;
    color: #4338ca;
}
.acd-btn-aging-toggle:hover {
    background: #4f46e5;
    color: #fff;
}

/* Status Pill */
.acd-status-pill {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
}
.acd-pill-draft {
    background: #fffbeb;
    color: #b45309;
    border: 1px solid #fef3c7;
}
.acd-page[data-theme="dark"] .acd-pill-draft {
    background: #3a2c10;
    color: #fbbf24;
    border-color: #4a3714;
}

.acd-badge-pill {
    background: #eef2ff;
    color: var(--acd-primary);
    font-size: 11px;
    font-weight: 800;
    padding: 3px 8px;
    border-radius: 6px;
    text-transform: uppercase;
}
.acd-page[data-theme="dark"] .acd-badge-pill {
    background: #262a3e;
    color: #a5b4fc;
}

/* Draft Card Body */
.acd-card-draft-body {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin: 18px 0 14px 0;
}
.acd-card-draft-count {
    font-size: 42px;
    font-weight: 900;
    line-height: 1;
    color: var(--acd-text);
    background: linear-gradient(90deg, var(--acd-text), var(--acd-primary));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}
.acd-card-draft-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
}
.acd-stat-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--acd-text-3);
    text-transform: uppercase;
    letter-spacing: 0.4px;
}
.acd-card-draft-amount {
    font-size: 20px;
    font-weight: 800;
    color: var(--acd-text);
    margin-top: 2px;
}
.acd-card-action-btn {
    width: 100%;
    margin-top: auto;
    padding: 8px;
    background: var(--acd-bg);
    border: none;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    color: var(--acd-primary);
    cursor: pointer;
    transition: all .2s;
    letter-spacing: 0.3px;
}
.acd-card-action-btn:hover {
    background: var(--acd-primary);
    color: #fff;
}

/* Approval Grid (3 Columns) */
.acd-approval-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
}
.acd-approval-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px 18px;
    background: var(--acd-bg);
    border: 1px solid var(--acd-border);
    border-radius: 12px;
    transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
}
.acd-approval-card.is-clickable { cursor: pointer; }
.acd-approval-card.is-clickable:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 20px rgba(17,24,39,0.10);
    border-color: var(--acd-primary);
}
.acd-approval-icon {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.acd-approval-info { min-width: 0; }
.acd-approval-value {
    font-size: 28px;
    font-weight: 900;
    color: var(--acd-text);
    line-height: 1.1;
}
.acd-approval-label {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--acd-text-2);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* Currencies Grid */
.acd-currency-section {
    margin-top: 14px;
}
.acd-currency-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 10px;
}
.acd-currency-box {
    background: var(--acd-bg);
    padding: 14px 12px;
    border-radius: 10px;
    border: 1px solid var(--acd-border);
    text-align: center;
    transition: background .2s ease, border-color .2s ease, transform .15s ease;
}
.acd-currency-box:hover {
    background: #eef2ff;
    border-color: #c7d2fe;
    transform: translateY(-2px);
}
.acd-currency-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: var(--acd-text-3);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
}
.acd-currency-value {
    font-size: 17px;
    font-weight: 800;
    color: var(--acd-text);
}

/* Aging Payables Chart */
.acd-chart-container {
    margin-top: 8px;
}
.acd-bar-chart {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    height: 100%;
    gap: 8px;
}
.acd-bar-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    height: 100%;
    justify-content: flex-end;
    cursor: default;
}
.acd-bar {
    width: 100%;
    max-width: 48px;
    min-height: 8px;
    transition: all .3s;
    background: var(--acd-primary);
}
.acd-bar:hover { opacity: 0.85; transform: scaleY(1.04); }
.acd-bar-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--acd-text-3);
    margin-top: 8px;
    text-transform: uppercase;
}
.acd-bar-value {
    font-size: 11px;
    font-weight: 700;
    color: var(--acd-text-2);
    margin-bottom: 5px;
}

/* Segmented Bar & Supplier Legend */
.acd-card-view-all-btn.active {
    background: var(--acd-primary) !important;
    color: #ffffff !important;
    border-color: var(--acd-primary) !important;
}
.acd-bar-segment {
    transition: all 0.2s ease;
    cursor: pointer;
}
.acd-bar-segment:hover {
    filter: brightness(1.25);
    transform: scaleX(1.05);
}
.acd-supp-legend-wrap {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--acd-border);
}
.acd-supp-legend-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
}
.acd-supp-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px;
    background: var(--acd-surface);
    border: 1px solid var(--acd-border);
    border-radius: 20px;
    font-size: 12px;
    cursor: pointer;
    transition: all .2s cubic-bezier(0.4, 0, 0.2, 1);
}
.acd-supp-legend-item:hover {
    border-color: var(--acd-primary);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.12);
}
.acd-supp-legend-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
}
.acd-supp-legend-name {
    font-weight: 600;
    color: var(--acd-text-2);
}
.acd-supp-legend-val {
    font-weight: 800;
    color: var(--acd-text);
    margin-left: 2px;
}

/* Data Table (EBRC & Supplier Group) */
.acd-table-wrapper {
    overflow-x: auto;
}
.acd-data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
}
.acd-data-table th {
    text-align: left;
    padding: 10px 12px;
    font-size: 11px;
    font-weight: 700;
    color: var(--acd-text-3);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    border-bottom: 1.5px solid var(--acd-border);
}
.acd-data-table td {
    padding: 12px;
    border-bottom: 1px solid var(--acd-border);
    color: var(--acd-text-2);
}
.acd-data-table tbody tr:hover td {
    background: color-mix(in srgb, var(--acd-primary) 6%, transparent);
}

/* Shimmer Loading */
.acd-shimmer {
    background: linear-gradient(90deg, #f0f0f0 25%, #e5e7eb 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: acd-shimmer 1.5s infinite;
    border-radius: 10px;
}
@keyframes acd-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

/* Tooltip */
.acd-tooltip {
    position: fixed;
    background: rgba(0,0,0,0.85);
    color: #fff;
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 5px;
    pointer-events: none;
    z-index: 10000;
    display: none;
}

/* Error */
.acd-error {
    text-align: center;
    padding: 40px 20px;
    background: var(--acd-surface);
    border-radius: 12px;
    border: 1px solid var(--acd-border);
}
.acd-error p { color: var(--acd-text-3); margin-bottom: 14px; font-size: 15px; }

/* Modal */
.acd-modal {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
}
.acd-modal.hidden { display: none; }
.acd-modal-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.5);
    cursor: pointer;
}
.acd-modal-content {
    position: relative;
    background: var(--acd-surface);
    border-radius: 16px;
    max-width: 900px;
    width: 100%;
    max-height: 84vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 70px rgba(0,0,0,0.25);
    overflow: hidden;
}
.acd-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 20px 24px;
    border-bottom: 1px solid var(--acd-border);
}
.acd-modal-header h3 {
    font-size: 20px;
    font-weight: 800;
    margin: 0;
    color: var(--acd-text);
}
.acd-modal-subtitle {
    font-size: 14px;
    font-weight: 600;
    color: var(--acd-text-3);
    margin-top: 3px;
}
.acd-modal-close {
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    border: 1px solid var(--acd-border);
    background: var(--acd-surface);
    border-radius: 8px;
    font-size: 18px;
    line-height: 1;
    color: var(--acd-text-2);
    cursor: pointer;
    transition: background .15s ease, border-color .15s ease;
}
.acd-modal-close:hover { background: var(--acd-bg); border-color: var(--acd-text-3); }
.acd-modal-stats {
    display: flex;
    align-items: center;
    padding: 16px 24px;
    background: var(--acd-bg);
    border-bottom: 1px solid var(--acd-border);
}
.acd-modal-stats-main { display: flex; flex-direction: column; }
.acd-modal-stats-value {
    font-size: 30px;
    font-weight: 900;
    color: var(--acd-text);
    line-height: 1.1;
}
.acd-modal-stats-label {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--acd-text-3);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-top: 2px;
}
.acd-modal-view-btn {
    border: 1px solid var(--acd-primary);
    background: transparent;
    color: var(--acd-primary);
    font-size: 13px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all .15s ease;
}
.acd-modal-view-btn:hover { background: var(--acd-primary); color: #fff; }
.acd-modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 24px 20px;
}
.acd-modal-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
}
.acd-modal-table th {
    text-align: left;
    padding: 10px;
    font-size: 11px;
    font-weight: 700;
    color: var(--acd-text-3);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    border-bottom: 2px solid var(--acd-border);
    background: var(--acd-surface);
    position: sticky;
    top: 0;
}
.acd-modal-table td {
    padding: 10px;
    border-bottom: 1px solid var(--acd-border);
    color: var(--acd-text-2);
}
.acd-modal-table td:last-child { white-space: nowrap; }
.acd-modal-table tbody tr:nth-child(even) td { background: var(--acd-bg); }
.acd-modal-table tbody tr:hover td {
    background: color-mix(in srgb, var(--acd-text) 8%, transparent);
}
.acd-modal-key { font-weight: 700; color: var(--acd-text); }
.acd-modal-amount { font-weight: 700; color: var(--acd-text); text-align: right; }
.acd-modal-row-clickable { cursor: pointer; }

/* Calendar popup styling */
.datepicker {
    border-radius: 10px !important;
    box-shadow: 0 8px 28px rgba(0,0,0,0.16) !important;
}
body.acd-calendar-dark .datepicker {
    background: #1c1f2b;
    color: #f3f4f6;
    border-color: #2c2f3d;
    box-shadow: 0 8px 28px rgba(0,0,0,0.45) !important;
}
body.acd-calendar-dark .datepicker--nav { border-color: #2c2f3d; }
body.acd-calendar-dark .datepicker--nav-title,
body.acd-calendar-dark .datepicker--nav-action { color: #f3f4f6; }
body.acd-calendar-dark .datepicker--nav-title:hover,
body.acd-calendar-dark .datepicker--nav-action:hover { background-color: #262a45; }
body.acd-calendar-dark .datepicker--day-name { color: #8b8fa3; }
body.acd-calendar-dark .datepicker--cell { color: #cbd0dc; }
body.acd-calendar-dark .datepicker--cell.-other-month- { color: #4b5169; }
body.acd-calendar-dark .datepicker--cell.-current- { color: #f3f4f6; }
body.acd-calendar-dark .datepicker--cell:hover,
body.acd-calendar-dark .datepicker--cell.-focus- { background: #262a45; }
body.acd-calendar-dark .datepicker--cell.-in-range- { background: #262a45; color: #f3f4f6; }
body.acd-calendar-dark .datepicker--cell.-selected-,
body.acd-calendar-dark .datepicker--cell.-current-.-selected- {
    background: #6366f1;
    color: #fff;
}
body.acd-calendar-dark .datepicker--button {
    color: #a5b4fc;
    border-color: #2c2f3d;
}
body.acd-calendar-dark .datepicker--button:hover { background: #262a45; }

/* Responsive */
@media (max-width: 1024px) {
    .acd-bento-span-4, .acd-bento-span-6 { grid-column: span 12; }
    .acd-approval-grid { grid-template-columns: repeat(2, 1fr); }
    .acd-filter-bar { flex-direction: column; align-items: stretch; }
    .acd-filter-right { margin-left: 0; }
    .acd-custom-range { flex-wrap: wrap; }
}
@media (max-width: 768px) {
    .acd-shell { padding: 8px 12px; }
    .acd-card { padding: 14px 16px; }
    .acd-approval-grid { grid-template-columns: 1fr; }
    .acd-chart-container { height: 160px; }
}
</style>`);
    }
};