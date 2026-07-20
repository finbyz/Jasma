app_name = "jasma"
app_title = "Jasma"
app_publisher = "Finbyz tech"
app_description = "Jasma"
app_email = "info@finbyz.tech"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "jasma",
# 		"logo": "/assets/jasma/logo.png",
# 		"title": "Jasma",
# 		"route": "/jasma",
# 		"has_permission": "jasma.api.permission.has_app_permission"
# 	}
# ]
fixtures = [
    {
        "dt": "Custom Field",
        "filters": {
            "module": ["in", ["Jasma"]]
        },
    },
    {
        "dt": "Property Setter",
        "filters": {
            "module": ["in", ["Jasma"]]
        },
    }
]
# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/jasma/css/jasma.css"
# app_include_js = "/assets/jasma/js/jasma.js"
app_include_js = [
    "jasma.bundle.js",
    "/assets/jasma/js/file_uploader_link_name.js",
]
# include js, css files in header of web template
# web_include_css = "/assets/jasma/css/jasma.css"
# web_include_js = "/assets/jasma/js/jasma.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "jasma/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views

doctype_js = {
	"Stock Entry": "public/js/stock_entry.js",
	"Purchase Receipt": "public/js/purchase_receipt.js",
	"Material Request": "public/js/material_request.js",
	"Production Plan": "public/js/production_plan.js",
	"Purchase Order": "public/js/purchase_order.js",
	"Subcontracting Receipt": "public/js/subcontracting_reciept.js",
	"Sales Invoice": "public/js/sales_invoice.js",
	"Sales Order": "public/js/Sales_order.js",
	"Quotation": "public/js/quotation.js",
	"Item": "public/js/item.js",
	"Employee Advance": "public/js/employee_advance.js",
	"Payment Entry": "public/js/payment_entry.js",
	"Purchase Invoice": "public/js/purchase_invoice.js"
}

doctype_list_js = {
    "Payment Entry": "public/js/list_js/payment_entry_list.js"
}
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}

# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "jasma/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "jasma.utils.jinja_methods",
# 	"filters": "jasma.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "jasma.install.before_install"
# after_install = "jasma.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "jasma.uninstall.before_uninstall"
# after_uninstall = "jasma.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "jasma.utils.before_app_install"
# after_app_install = "jasma.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "jasma.utils.before_app_uninstall"
# after_app_uninstall = "jasma.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "jasma.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	"Item": {
		"validate": "jasma.jasma.doc_events.item.validate",
	},
	"Purchase Receipt": {
		"before_submit": "jasma.jasma.doc_events.purchase_reciept.validate_qc_report",
        "on_submit": "jasma.jasma.doc_events.purchase_reciept.create_purchase_invoice_on_submit"
	},
	"Production Plan": {
         "on_submit": [
            "jasma.jasma.doc_events.production_plan.create_mr_on_submit",
        ],
         "before_cancel":"jasma.jasma.doc_events.production_plan.before_cancel",
		 "validate":"jasma.jasma.doc_events.production_plan.validate"
    },
	"Purchase Order": {
        "on_submit": "jasma.jasma.doc_events.purchase_order.before_submit",
		# "validate": "jasma.jasma.doc_events.purchase_order.validate_delivery_schedule_qty"
    },
    "Purchase Invoice": {
        "validate": "jasma.jasma.doc_events.purchase_invoice.set_po_pr_numbers",
    },
	"Subcontracting Receipt": {
		"before_submit": "jasma.jasma.doc_events.subcontracting_reciept.validate_qc_report",
		"on_submit": "jasma.jasma.doc_events.subcontracting_reciept.subcontracting_receipt_on_submit"
	},
 	"Subcontracting Order": {
		"before_submit": "jasma.jasma.doc_events.subcontracting_order.before_submit",
		# "on_cancel": "jasma.jasma.doc_events.subcontracting_order.on_cancel"
	},
  	"Stock Entry": {
		"before_submit": "jasma.jasma.doc_events.stock_entry.validate_qc_report"
	},
    "Sales Order": {
		"validate": [
            "jasma.jasma.doc_events.Sales_order.set_quotation_numbers",
            # "jasma.jasma.doc_events.Sales_order.distribute_packing_charges"
        ]
	},
    "Material Request": {
		"validate": "jasma.jasma.doc_events.material_request.validate"
	},
    # "Payment Entry": {
    #     "on_submit": "jasma.jasma.doc_events.payment_entry.update_employee_advance_balance"
    # }
    
    "Expense Claim": {
        "on_submit": "jasma.api.update_employee_advance_balance",
        "on_cancel": "jasma.api.update_employee_advance_balance"
    },
    "Journal Entry": {
        "on_submit": "jasma.api.update_employee_advance_balance",
        "on_cancel": "jasma.api.update_employee_advance_balance"
    },
    "Payment Entry": {
        "on_submit": "jasma.api.update_employee_advance_balance",
        "on_cancel": "jasma.api.update_employee_advance_balance",
        "before_submit": "jasma.jasma.doc_events.payment_entry.validate_future_payment_date"
    },
    "Employee Advance": {
        "on_submit": "jasma.jasma.doc_events.employee_advance.create_payment_entry"
    },
    "Sales Invoice": {
        "before_save": "jasma.jasma.doc_events.sales_invoice.before_save"
    }
   
}

# Scheduled Tasks
# ---------------x	

# scheduler_events = {
# 	"all": [
# 		"jasma.tasks.all"
# 	],
# 	"daily": [
# 		"jasma.tasks.daily"
# 	],
# 	"hourly": [
# 		"jasma.tasks.hourly"
# 	],
# 	"weekly": [
# 		"jasma.tasks.weekly"
# 	],
# 	"monthly": [
# 		"jasma.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "jasma.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "jasma.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
override_whitelisted_methods = {
	"erpnext.selling.doctype.sales_order.sales_order.make_material_request": "jasma.jasma.ovveride.material_request.make_material_request"
}
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "jasma.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["jasma.utils.before_request"]
# after_request = ["jasma.utils.after_request"]

# Job Events
# ----------
# before_job = ["jasma.utils.before_job"]
# after_job = ["jasma.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]
override_doctype_class = {
    "Material Request": "jasma.jasma.ovveride.material_request.CustomMaterialRequest",
    "Purchase Order": "jasma.jasma.ovveride.purchase_order.CustomPurchaseOrder",
    "Payment Entry": "jasma.jasma.ovveride.payment_entry.PaymentEntry"
}

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"jasma.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

fixtures = [
	{"dt": "Custom Field", "filters": {"module": "jasma"}},
	{"dt": "Property Setter", "filters": {"module": "jasma"}},
]