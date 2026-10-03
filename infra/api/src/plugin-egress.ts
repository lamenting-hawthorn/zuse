import type { PluginAuth } from "./plugin-catalog.ts";
import { PluginOperationError } from "./plugin-host.ts";

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal"];
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * The single outbound policy for catalog endpoints, OAuth metadata, token
 * calls and authorization URLs: public HTTPS hostnames on the default port.
 * The Worker URL parser canonicalizes numeric hosts, so IPv4 shorthands are
 * caught by the dotted-quad check.
 */
export const isAllowedPluginUrl = (value: string): boolean => {
	if (!URL.canParse(value)) return false;
	const url = new URL(value);
	const host = url.hostname.toLowerCase();
	return (
		url.protocol === "https:" &&
		!url.username &&
		!url.password &&
		url.port === "" &&
		host.includes(".") &&
		!host.endsWith(".") &&
		!host.startsWith("[") &&
		!IPV4.test(host) &&
		host !== "localhost" &&
		!BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))
	);
};

export const assertPluginUrl = (value: string) => {
	if (!isAllowedPluginUrl(value))
		throw new Error("Plugin endpoint is not allowed");
};

/** Policy-checked fetch that never follows redirects. */
export const pluginFetch: typeof fetch = async (input, init) => {
	assertPluginUrl(
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url,
	);
	const response = await fetch(input, {
		...init,
		redirect: "manual",
		signal: AbortSignal.any([
			...(init?.signal ? [init.signal] : []),
			AbortSignal.timeout(30_000),
		]),
	});
	if (response.status >= 300 && response.status < 400)
		throw new Error("Plugin redirects are not allowed");
	return response;
};

const PROBE_PROTOCOL = "2025-06-18";

/**
 * Anonymous MCP `initialize`: success means no sign-in, 401/403 means OAuth.
 * Tools are never listed or called.
 */
export async function probePluginAuth(
	endpoint: string,
	request: typeof fetch = pluginFetch,
): Promise<PluginAuth> {
	let response: Response;
	try {
		response = await request(endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: PROBE_PROTOCOL,
					capabilities: {},
					clientInfo: { name: "zuse-auth-probe", version: "1.0.0" },
				},
			}),
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		throw new PluginOperationError({ code: "plugin_unreachable" });
	}
	await response.body?.cancel().catch(() => undefined);
	if (response.ok) {
		// A public server may allocate a session for this check; release it.
		const session = response.headers.get("mcp-session-id");
		if (session)
			await request(endpoint, {
				method: "DELETE",
				headers: {
					"mcp-session-id": session,
					"mcp-protocol-version": PROBE_PROTOCOL,
				},
				signal: AbortSignal.timeout(1_000),
			})
				.then((released) => released.body?.cancel())
				.catch(() => undefined);
		return "none";
	}
	if (response.status === 401 || response.status === 403) return "oauth";
	if (response.status === 429 || response.status >= 500)
		throw new PluginOperationError({ code: "plugin_unreachable" });
	throw new PluginOperationError({ code: "plugin_auth_unsupported" });
}
