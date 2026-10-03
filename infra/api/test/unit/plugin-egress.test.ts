import { expect, test, vi } from "vitest";
import {
	isAllowedPluginUrl,
	probePluginAuth,
} from "../../src/plugin-egress.ts";
import { PluginOperationError } from "../../src/plugin-host.ts";

test("origin policy allows public HTTPS hosts on the default port only", () => {
	for (const allowed of [
		"https://mcp.linear.app/mcp",
		"https://mcp.example.com:443/mcp?mode=tools",
		"https://auth.example.co.uk/authorize?state=x",
	])
		expect(isAllowedPluginUrl(allowed), allowed).toBe(true);
	for (const blocked of [
		"http://mcp.example.com/mcp",
		"https://user:pass@mcp.example.com/mcp",
		"https://mcp.example.com:8443/mcp",
		"https://127.0.0.1/mcp",
		"https://2130706433/mcp",
		"https://0x7f.0.0.1/mcp",
		"https://[::1]/mcp",
		"https://localhost/mcp",
		"https://api.localhost/mcp",
		"https://printer.local/mcp",
		"https://metadata.google.internal/mcp",
		"https://intranet/mcp",
		"https://mcp.example.com./mcp",
		"not a url",
	])
		expect(isAllowedPluginUrl(blocked), blocked).toBe(false);
});

const respond = (status: number, headers?: Record<string, string>) =>
	vi.fn(async () => new Response(null, { status, headers }));

test("auth probe maps anonymous initialize results", async () => {
	const ok = respond(200);
	expect(await probePluginAuth("https://mcp.example.com/mcp", ok)).toBe("none");
	const [, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
	expect(init.method).toBe("POST");
	expect(new Headers(init.headers).get("accept")).toBe(
		"application/json, text/event-stream",
	);
	expect(JSON.parse(String(init.body))).toMatchObject({
		jsonrpc: "2.0",
		method: "initialize",
		params: { protocolVersion: "2025-06-18" },
	});
	expect(await probePluginAuth("https://x.example.com", respond(401))).toBe(
		"oauth",
	);
	expect(await probePluginAuth("https://x.example.com", respond(403))).toBe(
		"oauth",
	);
	const session = respond(200, { "mcp-session-id": "s1" });
	await probePluginAuth("https://x.example.com", session);
	expect(session).toHaveBeenCalledTimes(2);
	for (const [request, code] of [
		[respond(404), "plugin_auth_unsupported"],
		[respond(503), "plugin_unreachable"],
		[respond(429), "plugin_unreachable"],
		[
			vi.fn(async () => {
				throw new Error("timeout");
			}),
			"plugin_unreachable",
		],
	] as const)
		await expect(
			probePluginAuth("https://x.example.com", request),
		).rejects.toEqual(new PluginOperationError({ code }));
});
