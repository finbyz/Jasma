// Keep Jasma web-link file-name customization outside Frappe core.
(function () {
	const PATCH_FLAG = "__jasma_link_file_name_patch";

	function get_web_link_area(file_uploader) {
		return file_uploader.wrapper?.querySelector(".file-web-link");
	}

	function ensure_file_name_field(file_uploader) {
		const web_link_area = get_web_link_area(file_uploader);
		if (!web_link_area || web_link_area.querySelector(".jasma-link-file-name")) {
			return;
		}

		const field_group = document.createElement("div");
		field_group.className = "input-group jasma-link-file-name";
		field_group.style.marginTop = "10px";

		const input = document.createElement("input");
		input.type = "text";
		input.className = "form-control";
		input.placeholder = __("File Name");

		field_group.appendChild(input);
		const link_field = web_link_area.querySelector(".input-group");
		if (link_field) {
			link_field.after(field_group);
		} else {
			web_link_area.appendChild(field_group);
		}
	}

	function upload_web_link_with_name(file_uploader, web_link_area) {
		const url_input = web_link_area.querySelector(
			".input-group:not(.jasma-link-file-name) input.form-control"
		);
		const file_url = url_input?.value;

		if (!file_url) {
			frappe.msgprint(__("Invalid URL"));
			file_uploader.uploader.close_dialog = true;
			return Promise.reject();
		}

		const file_name = (
			web_link_area.querySelector(".jasma-link-file-name input")?.value || ""
		).trim();

		file_uploader.uploader.close_dialog = true;
		return file_uploader.uploader.upload_file({
			file_url: decodeURI(file_url),
			file_name,
		});
	}

	function patch_file_uploader() {
		if (!window.frappe?.ui?.FileUploader) {
			return;
		}

		const BaseFileUploader = frappe.ui.FileUploader;
		if (BaseFileUploader[PATCH_FLAG]) {
			return;
		}

		class JasmaFileUploader extends BaseFileUploader {
			constructor(options = {}) {
				super(options);
				this.setup_link_file_name_field();
			}

			setup_link_file_name_field() {
				if (!this.wrapper) {
					return;
				}

				const ensure_field = () => ensure_file_name_field(this);
				const observer = new MutationObserver(ensure_field);
				observer.observe(this.wrapper, { childList: true, subtree: true });
				this.wrapper.addEventListener("click", () => setTimeout(ensure_field, 0), true);
				ensure_field();

				if (this.dialog?.$wrapper) {
					this.dialog.$wrapper.on("hidden.bs.modal", () => observer.disconnect());
				}
			}

			upload_files() {
				const web_link_area = get_web_link_area(this);
				if (!web_link_area) {
					return super.upload_files();
				}

				return upload_web_link_with_name(this, web_link_area);
			}
		}

		JasmaFileUploader[PATCH_FLAG] = true;
		JasmaFileUploader.__base_file_uploader = BaseFileUploader;
		frappe.ui.FileUploader = JasmaFileUploader;
	}

	function load_and_patch_file_uploader() {
		if (window.frappe?.ui?.FileUploader) {
			patch_file_uploader();
			return;
		}

		if (typeof window.frappe?.require === "function") {
			window.frappe.require("file_uploader.bundle.js", patch_file_uploader);
		}
	}

	if (window.frappe?.ready) {
		window.frappe.ready(load_and_patch_file_uploader);
	} else {
		load_and_patch_file_uploader();
	}
})();
