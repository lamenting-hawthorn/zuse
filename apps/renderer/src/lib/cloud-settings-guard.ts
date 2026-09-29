import "@zuse/i18n/english/shell";
import { message as uiMessage } from "@zuse/i18n";

let hasUnbuiltChanges = false;

export const setCloudSettingsUnbuiltChanges = (value: boolean): void => {
	hasUnbuiltChanges = value;
};

export const requestCloudSettingsLeave = (): boolean =>
	!hasUnbuiltChanges ||
	window.confirm(uiMessage("shell:cloud_image_leave_warning"));
