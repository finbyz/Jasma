import frappe

def set_quotation_numbers(doc, method):
    
    if doc.quotation:
        return
    
    quotation_list = []

    for row in doc.items:
        if row.prevdoc_docname:
            if row.prevdoc_docname not in quotation_list:
                quotation_list.append(row.prevdoc_docname)

    doc.quotation = ", ".join(quotation_list)
    



def update_project_item_details(doc, method):
	"""
	Triggered on Sales Order submit.
	Pushes item rows into the linked Project's item_details child table,
	grouped by the 'project' field set on each Sales Order Item row.
	"""
	projects_to_update = {}

	for item in doc.items:
		if not item.get("project"):
			continue
		projects_to_update.setdefault(item.project, []).append(item)

	for project_name, items in projects_to_update.items():
		if not frappe.db.exists("Project", project_name):
			frappe.log_error(
				title="Project Sync Failed",
				message=f"Project {project_name} not found for Sales Order {doc.name}"
			)
			continue

		project = frappe.get_doc("Project", project_name)

		for item in items:
			project.append("item_details", {
				"item_code": item.item_code,
				"item_name": item.item_name,
				"description": item.description,
				"qty": item.qty,
				"rate": item.rate,
				"amount": item.amount,
				"comments": item.get("comments") or "",
				"sales_order": doc.name,
			})

		project.save(ignore_permissions=True)


def remove_project_item_details(doc, method):
	"""
	Triggered on Sales Order cancel.
	Removes only the item_details rows that were added by this Sales Order,
	leaving rows from other sources untouched.
	"""
	projects_touched = {item.project for item in doc.items if item.get("project")}

	for project_name in projects_touched:
		if not frappe.db.exists("Project", project_name):
			continue

		project = frappe.get_doc("Project", project_name)
		project.item_details = [
			row for row in project.item_details
			if row.sales_order != doc.name
		]
		project.save(ignore_permissions=True)