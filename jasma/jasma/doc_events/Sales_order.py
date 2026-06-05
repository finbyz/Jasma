def set_quotation_numbers(doc, method):
    
    if doc.quotation:
        return
    
    quotation_list = []

    for row in doc.items:
        if row.prevdoc_docname:
            if row.prevdoc_docname not in quotation_list:
                quotation_list.append(row.prevdoc_docname)

    doc.quotation = ", ".join(quotation_list)