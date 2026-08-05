# jasma/jasma/doc_events/bom.py

import frappe
from frappe.utils import get_link_to_form


def deactivate_other_boms(doc, method=None):
    """
    When a BOM is Active + Default, set all other BOMs for the same item
    to Inactive — gated by Manufacturing Settings checkbox
    'auto_deactivate_other_boms_on_new_active_bom'.

    Runs on both submit and update:
    - on_submit: fires when the BOM is first submitted as active+default.
    - on_update: fires if is_active/is_default is toggled later via save
      on an already-submitted BOM (docstatus check below prevents this
      from firing on drafts, since a draft BOM isn't operationally in use).

    """
    # frappe.throw("hello")
    if doc.docstatus != 1:
        return
    
    if not (doc.is_active and doc.is_default):
        return

    if not frappe.db.get_single_value(
        "Manufacturing Settings", "auto_deactivate_other_boms_on_new_active_bom"
    ):
        return

    other_boms = frappe.get_all(
        "BOM",
        filters={
            "item": doc.item,
            "name": ["!=", doc.name],
            "is_active": 1,
            "docstatus": 1,
        },
        pluck="name",
    )

    for bom_name in other_boms:
        frappe.db.set_value("BOM", bom_name, "is_active", 0, update_modified=False)

    if other_boms:
        links = ", ".join(get_link_to_form("BOM", b) for b in other_boms)
        frappe.msgprint(
            frappe._("Deactivated other BOM(s) for this item: {0}").format(links),
            alert=True,
            indicator="orange",
        )