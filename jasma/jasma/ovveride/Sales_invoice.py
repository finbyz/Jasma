"""
Jamsa App override for Exim's Sales Invoice `calculate_total`.

WHY: Exim's original logic only subtracts freight (not insurance) for
incoterms CFR, CPT, DAP, DPU, DDP when computing `fob_value`. This
override also subtracts insurance for that same set of incoterms.

HOW: Frappe resolves doc_event hook paths (strings in hooks.py) via
frappe.get_attr() at call time, not at import time. So reassigning the
`calculate_total` attribute on Exim's module — before the hook fires —
causes Frappe to run this version instead. No changes to Exim's code
are needed.

IMPORTANT:
- Adjust the import path below (`exim.overrides.sales_invoice`) to match
  wherever `calculate_total` actually lives in your installed Exim app.
  Check Exim's hooks.py -> doc_events -> "Sales Invoice" -> "before_save"
  to confirm the exact dotted path.
- This file must be imported somewhere that runs at app load time
  (see jamsa/__init__.py wiring below), otherwise the patch never applies.
"""

import frappe
from frappe.utils import flt

# Adjust this import to match Exim's real module path
from exim.exim.doc_events.sales_invoice import calculate_total as exim_calculate_total


def calculate_total(self):
	total_qty = 0
	total_packages = 0
	total_gr_wt = 0
	total_tare_wt = 0
	total_freight = 0
	total_insurance = 0
	total_meis = 0
	total_drawback = 0
	total_rodtep = 0
	total_fob_value = 0
	total_pallets = 0

	if (
		self.gst_category == "Overseas"
		and not self.manually_enter_fob_value
		and self.freight_calculated in ["By Qty", "By Amount"]
		and self.incoterm not in ["CIF", "CFR", "CNF", "CPT"]
	):
		frappe.msgprint(
			f"To calculate item wise freight please ensure incoterm is set either of "
			f"{frappe.bold('CIF, CFR, CNF OR CPT')}."
		)

	for row in self.items:
		if self.freight_calculated == "By Qty":
			row.freight = (row.qty * self.freight) / self.total_qty
			row.insurance = (row.qty * self.insurance) / self.total_qty
		elif self.freight_calculated == "By Amount":
			row.freight = (row.base_amount * self.freight) / self.base_total
			row.insurance = (row.base_amount * self.insurance) / self.base_total
		else:
			total_freight += flt(row.freight)
			total_insurance += flt(row.insurance)

		total_qty += flt(row.qty)
		total_packages += flt(row.no_of_packages)

		row.total_tare_weight = flt(row.tare_wt * row.no_of_packages)

		pallet = flt(row.pallet_weight) * flt(row.total_pallets)
		row.gross_wt = (
			flt(row.total_tare_weight)
			+ (flt(row.qty) * (flt(row.weight_per_unit) or 1))
			+ flt(pallet)
		)

		if not self.manually_enter_fob_value and self.gst_category == "Overseas":

			if self.incoterm in ["CIF", "CIP"]:
				row.fob_value = (
					flt(row.base_amount)
					- flt(row.freight * self.conversion_rate)
					- flt(row.insurance * self.conversion_rate)
				)

			# --- JAMSA CHANGE: also subtract insurance for these incoterms ---
			elif self.incoterm in ["CFR", "CPT", "DAP", "DPU", "DDP"]:
				row.fob_value = (
					flt(row.base_amount)
					- flt(row.freight * self.conversion_rate)
					- flt(row.insurance * self.conversion_rate)
				)
			# -------------------------------------------------------------------

			elif self.incoterm in ["EXW", "FCA", "FAS", "FOB"]:
				row.fob_value = flt(row.base_amount)

		total_tare_wt += flt(row.total_tare_weight)
		total_gr_wt += flt(row.gross_wt)
		total_insurance += flt(row.insurance)
		total_meis += flt(row.meis_value)
		total_drawback += row.duty_drawback_amount
		row.total_duty_drawback = total_drawback
		total_rodtep += row.meis_value
		total_fob_value += flt(row.fob_value)
		total_pallets += flt(row.total_pallets)

	self.total_qty = total_qty
	self.total_packages = total_packages
	self.total_gr_wt = total_gr_wt
	self.total_tare_wt = total_tare_wt
	if self.freight_calculated == "Manual":
		self.freight = total_freight
		self.insurance = total_insurance
	self.total_meis = total_meis
	self.total_fob_value = total_fob_value
	self.total_pallets = total_pallets


# Apply the patch: replace Exim's calculate_total with ours.
exim_calculate_total = calculate_total