
import frappe
from frappe.utils import flt


def validate(self,method):
	if self.item_group:
		path = []
		current = self.item_group

		while current and current != "All Item Groups":
			doc = frappe.db.get_value(
				"Item Group",
				current,
				["item_group_name", "parent_item_group"],
				as_dict=True
			)

			if not doc:
				break

			path.append(doc.item_group_name)
			current = doc.parent_item_group

		self.group = " - ".join(reversed(path))
		
def sync_drawing_number_to_default_bom(doc, method):
	if not doc.has_value_changed("drawing_1"):
		return

	if not frappe.db.get_single_value("Manufacturing Settings", "auto_update_bom_drawing_number_on_item_update"):
		return

	# 1. Find all BOMs where this item is used AND that BOM is marked default
	bom_item_rows = frappe.get_all(
		"BOM Item",
		filters={"item_code": doc.name},
		fields=["name", "parent"]
	)

	if not bom_item_rows:
		return

	parent_boms = list({row.parent for row in bom_item_rows})

	default_boms = frappe.get_all(
		"BOM",
		filters={"name": ["in", parent_boms], "is_default": 1},
		pluck="name"
	)

	if not default_boms:
		return

	default_boms_set = set(default_boms)

	# 2. BOM level: update drawing_number on each default BOM found
	for bom_name in default_boms:
		frappe.db.set_value(
			"BOM",
			bom_name,
			"drawing_number",
			doc.drawing_1,
			update_modified=False
		)

	# 3. BOM Item child table: update drawing_1 on rows within those default BOMs
	for row in bom_item_rows:
		if row.parent in default_boms_set:
			frappe.db.set_value(
				"BOM Item",
				row.name,
				"drawing_1",
				doc.drawing_1,
				update_modified=False
			)

# import frappe
# from frappe.utils import flt


# @frappe.whitelist()
# def get_export_forecast_data(item_code):
# 	if not frappe.db.get_value("Item", item_code, "is_stock_item"):
# 		return []

# 	so_items = frappe.db.sql("""
# 		SELECT
# 			so.name AS so_name,
# 			so.customer AS customer,
# 			soi.item_code AS fg_item,
# 			soi.item_name AS fg_item_name,
# 			soi.bom_no AS bom_no,
# 			(soi.qty - soi.delivered_qty) AS pending_qty
# 		FROM `tabSales Order Item` soi
# 		INNER JOIN `tabSales Order` so ON so.name = soi.parent
# 		WHERE so.docstatus = 1
# 			AND so.status NOT IN ('Closed', 'Cancelled')
# 			AND (soi.qty - soi.delivered_qty) > 0
# 			AND soi.bom_no IS NOT NULL
# 			AND soi.bom_no != ''
# 		ORDER BY so.transaction_date DESC
# 	""", as_dict=True)

# 	if not so_items:
# 		return []

# 	boms = list({row.bom_no for row in so_items})

# 	bom_rows = frappe.db.sql("""
# 		SELECT b.name AS bom_name, b.quantity AS bom_qty, SUM(bi.qty) AS total_raw_qty
# 		FROM `tabBOM` b
# 		INNER JOIN `tabBOM Item` bi ON bi.parent = b.name
# 		WHERE b.name IN %(boms)s
# 		GROUP BY b.name, b.quantity
# 	""", {"boms": boms}, as_dict=True)

# 	bom_per_unit = {
# 		r.bom_name: flt(r.total_raw_qty) / flt(r.bom_qty) for r in bom_rows if flt(r.bom_qty)
# 	}

# 	result = []
# 	for row in so_items:
# 		if row.bom_no in bom_per_unit:
# 			committed_qty = flt(row.pending_qty) * bom_per_unit[row.bom_no]
# 			result.append({
# 				"so_name": row.so_name,
# 				"customer": row.customer,
# 				"fg_item": row.fg_item,
# 				"fg_item_name": row.fg_item_name,
# 				"pending_qty": flt(row.pending_qty),
# 				"committed_qty": committed_qty
# 			})
import frappe
from frappe.utils import flt


def _get_component_ratio_map(item_code):
	"""For item_code as a raw material, find all Default+Active BOMs where it's
	used as a component (directly or via nested sub-assemblies), and return
	{fg_item: qty_per_unit}. Uses BOM Explosion Item (recursive, pre-flattened)
	as the primary source, with a fallback to BOM Item for any Default+Active
	BOM whose explosion table hasn't been regenerated yet."""

	# Primary: pre-flattened explosion table (handles nested sub-assemblies)
	rows = frappe.db.sql("""
		SELECT
			b.name AS bom_name,
			b.item AS fg_item,
			SUM(bei.qty_consumed_per_unit) AS comp_qty
		FROM `tabBOM Explosion Item` bei
		JOIN `tabBOM` b ON bei.parent = b.name
		WHERE bei.item_code = %(item_code)s
			AND b.docstatus = 1
			AND b.is_active = 1
			AND b.is_default = 1
		GROUP BY b.name, b.item
	""", {"item_code": item_code}, as_dict=True)

	boms_with_explosion = {r.bom_name for r in rows}

	# Fallback: Default+Active BOMs using this item directly, with no
	# Explosion Item rows at all (stale/never-regenerated explosion table)
	candidate_boms = frappe.db.sql("""
		SELECT DISTINCT b.name AS bom_name, b.item AS fg_item, b.quantity AS bom_qty
		FROM `tabBOM Item` bi
		JOIN `tabBOM` b ON bi.parent = b.name
		WHERE bi.item_code = %(item_code)s
			AND b.docstatus = 1
			AND b.is_active = 1
			AND b.is_default = 1
	""", {"item_code": item_code}, as_dict=True)

	missing_boms = [r for r in candidate_boms if r.bom_name not in boms_with_explosion]

	fallback_rows = []
	if missing_boms:
		missing_names = [r.bom_name for r in missing_boms]
		fallback_rows = frappe.db.sql("""
			SELECT
				bi.parent AS bom_name,
				b.item AS fg_item,
				SUM(bi.qty / IFNULL(NULLIF(b.quantity, 0), 1)) AS comp_qty
			FROM `tabBOM Item` bi
			JOIN `tabBOM` b ON bi.parent = b.name
			WHERE bi.parent IN %(bom_names)s
				AND bi.item_code = %(item_code)s
			GROUP BY bi.parent, b.item
		""", {"bom_names": tuple(missing_names), "item_code": item_code}, as_dict=True)

	ratio_map = {}
	for r in rows + fallback_rows:
		fg_item = r.get("fg_item")
		comp_qty = flt(r.get("comp_qty"))
		if not fg_item or comp_qty <= 0:
			continue
		ratio_map[fg_item] = ratio_map.get(fg_item, 0.0) + comp_qty

	return ratio_map


@frappe.whitelist()
def get_export_forecast_data(item_code):
	"""Direct (item ordered itself) + indirect (item used as BOM component) Sales Order demand."""
	if not frappe.db.get_value("Item", item_code, "is_stock_item"):
		return {"rows": [], "total_pending_qty": 0, "total_committed_qty": 0}

	ratio_map = _get_component_ratio_map(item_code)

	# ratio 1 for the item itself (direct), plus indirect parents
	fg_ratio_map = {item_code: 1.0}
	fg_ratio_map.update(ratio_map)

	fg_items = list(fg_ratio_map.keys())

	so_items = frappe.db.sql("""
		SELECT
			so.name AS so_name,
			so.customer AS customer,
			soi.item_code AS fg_item,
			soi.item_name AS fg_item_name,
			(soi.qty - soi.delivered_qty) AS pending_qty
		FROM `tabSales Order Item` soi
		INNER JOIN `tabSales Order` so ON so.name = soi.parent
		WHERE so.docstatus = 1
			AND so.status NOT IN ('Closed', 'Cancelled')
			AND (soi.qty - soi.delivered_qty) > 0
			AND soi.item_code IN %(fg_items)s
		ORDER BY so.transaction_date DESC
	""", {"fg_items": fg_items}, as_dict=True)

	if not so_items:
		return {"rows": [], "total_pending_qty": 0, "total_committed_qty": 0}

	rows = []
	total_pending_qty = 0
	total_committed_qty = 0

	for row in so_items:
		ratio = fg_ratio_map.get(row.fg_item, 0)
		if ratio <= 0:
			continue
		committed_qty = flt(row.pending_qty) * ratio
		rows.append({
			"so_name": row.so_name,
			"customer": row.customer,
			"fg_item": row.fg_item,
			"fg_item_name": row.fg_item_name,
			"pending_qty": flt(row.pending_qty),
			"committed_qty": committed_qty
		})
		total_pending_qty += flt(row.pending_qty)
		total_committed_qty += committed_qty

	return {
		"rows": rows,
		"total_pending_qty": total_pending_qty,
		"total_committed_qty": round(total_committed_qty, 2)
	}


@frappe.whitelist()
def get_quotation_forecast_data(item_code):
	"""Direct (item quoted itself) + indirect (item used as BOM component) Quotation demand.
	Only the portion of each Quotation Item NOT yet converted to a Sales Order counts as
	forecast (qty - ordered_qty). Lost quotations are excluded."""
	if not frappe.db.get_value("Item", item_code, "is_stock_item"):
		return {"rows": [], "total_pending_qty": 0, "total_committed_qty": 0}

	ratio_map = _get_component_ratio_map(item_code)

	fg_ratio_map = {item_code: 1.0}
	fg_ratio_map.update(ratio_map)

	fg_items = list(fg_ratio_map.keys())

	qtn_items = frappe.db.sql("""
		SELECT
			qtn.name AS qtn_name,
			qtn.party_name AS customer,
			qi.item_code AS fg_item,
			qi.item_name AS fg_item_name,
			(qi.qty - IFNULL(qi.ordered_qty, 0)) AS pending_qty
		FROM `tabQuotation Item` qi
		INNER JOIN `tabQuotation` qtn ON qtn.name = qi.parent
		WHERE qtn.docstatus = 1
			AND qtn.status != 'Lost'
			AND qi.item_code IN %(fg_items)s
			AND qi.qty > IFNULL(qi.ordered_qty, 0)
		ORDER BY qtn.transaction_date DESC
	""", {"fg_items": fg_items}, as_dict=True)

	if not qtn_items:
		return {"rows": [], "total_pending_qty": 0, "total_committed_qty": 0}

	rows = []
	total_pending_qty = 0
	total_committed_qty = 0

	for row in qtn_items:
		ratio = fg_ratio_map.get(row.fg_item, 0)
		if ratio <= 0:
			continue
		committed_qty = flt(row.pending_qty) * ratio
		rows.append({
			"qtn_name": row.qtn_name,
			"customer": row.customer,
			"fg_item": row.fg_item,
			"fg_item_name": row.fg_item_name,
			"pending_qty": flt(row.pending_qty),
			"committed_qty": committed_qty
		})
		total_pending_qty += flt(row.pending_qty)
		total_committed_qty += committed_qty

	return {
		"rows": rows,
		"total_pending_qty": total_pending_qty,
		"total_committed_qty": round(total_committed_qty, 2)
	}
 
 
 # jasma/jasma/doc_events/item.py



# jasma/jasma/doc_events/item.py

@frappe.whitelist()
def has_forecast_permission():
	"""
	Returns True only if the current user holds the role configured in
	Selling Settings > export_and_commited_qty_permission_role.
	If no role is configured, the button stays hidden for everyone.
	"""
	role = frappe.db.get_single_value(
		"Selling Settings", "export_and_commited_qty_permission_role"
	)

	if not role:
		return False

	return role in frappe.get_roles(frappe.session.user)