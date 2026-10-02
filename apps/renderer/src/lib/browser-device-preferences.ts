import { DevicePreferences, KeybindingsFile } from "@zuse/contracts";
import { Schema } from "effect";
import { createAtomStore } from "../state/atom-store.ts";

const STORAGE_KEY = "zuse.browser.device-preferences.v1";
const BrowserPreferences = Schema.Struct({
	...DevicePreferences.fields,
	keybindings: Schema.optional(KeybindingsFile.fields.rules),
});
const storage = () =>
	typeof window === "undefined" ? null : window.localStorage;
const read = (): typeof BrowserPreferences.Type => {
	try {
		return Schema.decodeUnknownSync(BrowserPreferences)(
			JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "{}"),
		);
	} catch {
		return {};
	}
};

/** Browser-owned appearance and notifications, independent of account configuration. */
export const useBrowserDevicePreferences = createAtomStore<
	typeof BrowserPreferences.Type
>(() => read());

export const updateBrowserDevicePreferences = (
	patch: typeof BrowserPreferences.Type,
): void => {
	const next = {
		...useBrowserDevicePreferences.getState(),
		...Schema.decodeUnknownSync(BrowserPreferences)(patch),
	};
	const target = storage();
	if (target === null)
		throw new Error("Browser preference storage is unavailable.");
	target.setItem(STORAGE_KEY, JSON.stringify(next));
	useBrowserDevicePreferences.setState(next, true);
};

if (typeof window !== "undefined")
	window.addEventListener("storage", (event) => {
		if (
			event.storageArea === storage() &&
			(event.key === STORAGE_KEY || event.key === null)
		)
			useBrowserDevicePreferences.setState(read(), true);
	});
