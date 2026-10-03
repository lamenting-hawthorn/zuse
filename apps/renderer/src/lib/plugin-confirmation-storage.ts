const key = "zuse.plugin-confirmation";
export const hasPluginConfirmation = () =>
	new URLSearchParams(window.location.search).has("plugin_ticket") ||
	sessionStorage.getItem(key) !== null;
export const clearPluginConfirmation = () => sessionStorage.removeItem(key);

/** Preserve a one-use ticket through hosted sign-in; never stores provider tokens. */
export function readPluginConfirmation(): {
	ticket: string;
	tenantId: string;
} | null {
	const url = new URL(window.location.href);
	const ticket = url.searchParams.get("plugin_ticket");
	const tenantId = url.searchParams.get("plugin_tenant");
	if (ticket && tenantId) {
		const pending = { ticket, tenantId };
		sessionStorage.setItem(key, JSON.stringify(pending));
		url.searchParams.delete("plugin_ticket");
		url.searchParams.delete("plugin_tenant");
		window.history.replaceState(null, "", url);
		return pending;
	}
	try {
		const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
		if (
			typeof stored !== "object" ||
			stored === null ||
			!("ticket" in stored) ||
			!("tenantId" in stored) ||
			typeof stored.ticket !== "string" ||
			typeof stored.tenantId !== "string"
		)
			return null;
		return { ticket: stored.ticket, tenantId: stored.tenantId };
	} catch {
		return null;
	}
}
