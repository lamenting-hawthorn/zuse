/**
 * A managed-plugin OAuth return. The Zuse API hands the browser that finished
 * consent a one-use ticket; the signed-in app redeems it with `complete`,
 * which the API only accepts from the account that started the connection.
 * Desktop receives it through the sign-in loopback, the web app through its
 * URL. Never carries provider tokens.
 */
export type PluginReturn = {
	readonly ticket: string | null;
	readonly tenantId: string;
	readonly plugin: string | null;
	readonly error: string | null;
};

const key = "zuse.plugin-return";
const params = [
	"plugin_ticket",
	"plugin_tenant",
	"plugin",
	"plugin_error",
] as const;

const text = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 && value.length <= 512
		? value
		: null;

/** Validate an untrusted value (IPC payload or stored JSON). */
export const parsePluginReturn = (value: unknown): PluginReturn | null => {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	const tenantId = text(record.tenantId);
	const ticket = text(record.ticket);
	const error = text(record.error);
	if (tenantId === null || (ticket === null) === (error === null)) return null;
	return { ticket, tenantId, plugin: text(record.plugin), error };
};

/**
 * Take a return from the web app URL, removing it from history. It's kept in
 * session storage so it survives a hosted sign-in redirect.
 */
export function takeUrlPluginReturn(): PluginReturn | null {
	const url = new URL(window.location.href);
	if (!url.searchParams.has("plugin_tenant")) return readStoredPluginReturn();
	const value = parsePluginReturn({
		ticket: url.searchParams.get("plugin_ticket"),
		tenantId: url.searchParams.get("plugin_tenant"),
		plugin: url.searchParams.get("plugin"),
		error: url.searchParams.get("plugin_error"),
	});
	for (const name of params) url.searchParams.delete(name);
	window.history.replaceState(window.history.state, "", url);
	if (value !== null) sessionStorage.setItem(key, JSON.stringify(value));
	return value;
}

export function readStoredPluginReturn(): PluginReturn | null {
	try {
		return parsePluginReturn(JSON.parse(sessionStorage.getItem(key) ?? "null"));
	} catch {
		return null;
	}
}

export const clearStoredPluginReturn = () => sessionStorage.removeItem(key);
