import frappe

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
