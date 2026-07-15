import frappe
from frappe.model.mapper import get_mapped_doc
from frappe.utils import flt, cint
from frappe import _

@frappe.whitelist()
def make_cash_discount(source_name, target_doc=None):
    doc = get_mapped_doc(
        "Purchase Invoice",
        source_name,
        {
            "Purchase Invoice": {
                "doctype": "Purchase Invoice",
                "field_no_map": [
                    "name",
                    "return_against",
                ],
            },
            "Purchase Invoice Item": {
                "doctype": "Purchase Invoice Item",
                "add_if_empty": True,
            },
            "Purchase Taxes and Charges": {
                "doctype": "Purchase Taxes and Charges",
                "add_if_empty": True,
            },
        },
        target_doc,
    )

    # Make sure Return Against is blank
    doc.return_against = None
    doc.items = None
    doc.is_return = 1
    doc.taxes =None
    return doc