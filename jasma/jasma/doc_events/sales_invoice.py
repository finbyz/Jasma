"""
Jamsa App — minimal override for Sales Invoice fob_value.

WHY: Exim's calculate_total() only subtracts freight (not insurance)
for incoterms CFR, CPT, DAP, DPU, DDP. This hook runs AFTER Exim's own
before_save chain (calculate_total -> duty_calculation -> meis_calculation)
and corrects fob_value by also subtracting insurance for that same set
of incoterms — then re-runs duty/meis calculation (reusing Exim's own
functions, not copies) so dependent fields stay consistent.

This does NOT monkeypatch or duplicate calculate_total. It's a normal
Frappe doc_event hook, registered in hooks.py.

REQUIREMENT: Jamsa must run its before_save hook AFTER Exim's for this
to work, since it corrects values Exim already set. Frappe fires
doc_event hooks in the order apps appear for the site (roughly, order
of installation). Check with:
    bench --site <site> list-apps
If Exim isn't listed before Jamsa, reinstall order or open a ticket
with Frappe on adjusting app hook order.
"""

import frappe
from frappe.utils import flt

# Reuse Exim's own duty/meis functions instead of copying their logic
from exim.exim.doc_events.sales_invoice import duty_calculation, meis_calculation

def before_save(doc, method):
    adjust_fob_value_for_insurance(doc, method)
    calculate_total_fob_values(doc,method)

def adjust_fob_value_for_insurance(doc, method):
	if doc.gst_category != "Overseas" or doc.manually_enter_fob_value:
		return

	if doc.incoterm not in ["CFR", "CPT", "DAP", "DPU", "DDP"]:
		return

	total_fob_value = 0
	for row in doc.items:
		row.fob_value = flt(row.fob_value) - flt(row.insurance * doc.conversion_rate)
		total_fob_value += flt(row.fob_value)

	doc.total_fob_value = total_fob_value

	# Dependent values used the old (freight-only) fob_value — recompute.
	duty_calculation(doc)
	meis_calculation(doc)
 

def calculate_total_fob_values(doc, method):
	"""
	Mirrors the client-side calculate_total_fob_values(frm) function.
	Runs server-side so the saved value doesn't depend on the browser
	having executed the JS in the right order (Exim vs Jamsa client
	scripts both touching the same fields).
	"""
	conversion_rate = flt(doc.conversion_rate)
	total_fob_value = flt(doc.total_fob_value)
 
	if not total_fob_value or not conversion_rate:
		doc.total_fob_values = 0
	else:
		doc.total_fob_values = flt(total_fob_value / conversion_rate, 2)
 
	doc.total_value = doc.total