import "@zuse/i18n/english/settings";
import { message as uiMessage } from "@zuse/i18n";

let hasUnbuiltChanges = false;

export const setCloudSettingsUnbuiltChanges = (value: boolean): void => {
	hasUnbuiltChanges = value;
};

export const requestCloudSettingsLeave = (): boolean =>
	!hasUnbuiltChanges ||
	window.confirm(uiMessage("settings:cloud_image_leave_warning"));
