import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, test } from "vitest";

let script: string;
beforeAll(async () => {
	const result = await build({
		entryPoints: [
			new URL("./plugin-vault-worker.ts", import.meta.url).pathname,
		],
		bundle: true,
		write: false,
		format: "esm",
		platform: "node",
		external: ["node:*"],
	});
	const output = result.outputFiles[0];
	if (!output) throw new Error("Worker bundle is missing");
	script = output.text;
});
function firstAddress(value: unknown): string {
	if (!Array.isArray(value) || typeof value[0]?.address !== "string")
		throw new Error("Missing tool address");
	return value[0].address;
}
let calls = 0;
let tokenExpiresIn = 3600;
let failTokenExchange = false;
let refreshes = 0;
let registration: Record<string, unknown> | undefined;
const outboundService = async (request: Request): Promise<Response> => {
	const url = new URL(request.url);
	if (url.pathname.includes("oauth-protected-resource"))
		return Response.json({
			resource: "https://mcp.linear.app/mcp",
			authorization_servers: ["https://mcp.linear.app"],
			scopes_supported: ["read", "write"],
		});
	if (
		url.pathname.includes("oauth-authorization-server") ||
		url.pathname.includes("openid-configuration")
	)
		return Response.json({
			issuer: "https://mcp.linear.app",
			authorization_endpoint: "https://mcp.linear.app/authorize",
			token_endpoint: "https://mcp.linear.app/token",
			registration_endpoint: "https://mcp.linear.app/register",
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["none"],
			scopes_supported: ["read", "write"],
		});
	if (url.pathname === "/register") {
		registration = await request.json();
		return Response.json(
			{ client_id: "zuse-test", token_endpoint_auth_method: "none" },
			{ status: 201 },
		);
	}
	if (url.pathname === "/token") {
		const form = new URLSearchParams(await request.text());
		if (form.get("grant_type") === "refresh_token") refreshes++;
		if (failTokenExchange)
			return Response.json({ error: "invalid_grant" }, { status: 400 });
		return Response.json({
			access_token: "private-upstream-token",
			refresh_token: "private-refresh-token",
			token_type: "Bearer",
			expires_in: tokenExpiresIn,
			scope: "read write",
		});
	}
	if (
		url.host === "mcp.linear.app" &&
		request.headers.get("authorization") !== "Bearer private-upstream-token"
	)
		return new Response(null, {
			status: 401,
			headers: {
				"www-authenticate":
					'Bearer resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource"',
			},
		});
	if (request.method !== "POST") return new Response(null, { status: 405 });
	const m = (await request.json()) as {
		id?: number;
		method: string;
		params?: { arguments?: { text?: string } };
	};
	if (m.id === undefined) return new Response(null, { status: 202 });
	if (m.method === "tools/call") calls++;
	const result =
		m.method === "initialize"
			? {
					protocolVersion: "2025-03-26",
					capabilities: { tools: {} },
					serverInfo: { name: "fixture", version: "1" },
				}
			: m.method === "tools/list"
				? {
						tools: [
							{
								name: "echo",
								inputSchema: {
									type: "object",
									properties: { text: { type: "string" } },
								},
							},
						],
					}
				: {
						content: [{ type: "text", text: m.params?.arguments?.text ?? "" }],
					};
	return Response.json({ jsonrpc: "2.0", id: m.id, result });
};
const instances = new Set<Miniflare>();
afterAll(async () => {
	await Promise.all([...instances].map((m) => m.dispose()));
});
const create = (persist?: string) => {
	const mf = new Miniflare({
		modules: true,
		script,
		compatibilityDate: "2026-06-01",
		compatibilityFlags: ["nodejs_compat"],
		durableObjects: {
			PLUGIN_VAULT: { className: "PluginVault", useSQLite: true },
		},
		durableObjectsPersist: persist,
		bindings: {
			PLUGIN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
			API_PUBLIC_ORIGIN: "https://api.zuse.test",
			PLUGIN_APP_ORIGIN: "https://code.zuse.test",
		},
		outboundService,
	});
	instances.add(mf);
	return mf;
};
async function client(
	mf: Miniflare,
	tenant = "personal:alice",
	subject = "alice",
) {
	const ns = await mf.getDurableObjectNamespace("PLUGIN_VAULT");
	const vault = ns.get(ns.idFromName(tenant));
	return {
		vault,
		request: async (command: unknown, tool?: unknown) => {
			const response = await vault.fetch("https://internal/request", {
				method: "POST",
				body: JSON.stringify({ identity: { tenant, subject }, command, tool }),
			});
			return {
				status: response.status,
				body: (await response.json()) as Record<string, unknown>,
			};
		},
	};
}
test("persists across Worker restarts and isolates subjects and tenants", async () => {
	const directory = await mkdtemp(join(tmpdir(), "zuse-plugin-vault-"));
	try {
		let mf = create(directory);
		let a = await client(mf);
		const command = {
			action: "connect",
			pluginId: "cloudflare",
			label: "Docs",
			requestId: crypto.randomUUID(),
		};
		const connected = await a.request(command);
		expect(connected.status).toBe(200);
		expect(connected.body.state).toBe("connected");
		expect((await a.request(command)).body.id).toBe(connected.body.id);
		const search = await a.request(undefined, { action: "search", query: "" });
		expect(search.body).toHaveLength(1);
		const address = firstAddress(search.body);
		expect(
			(await a.request(undefined, { action: "schema", address })).body
				.inputSchema,
		).toBeDefined();
		const before = calls;
		expect(
			(
				await a.request(undefined, {
					action: "call",
					address,
					arguments: { text: "works" },
				})
			).status,
		).toBe(200);
		expect(calls).toBe(before + 1);
		const bob = await client(mf, "personal:alice", "bob");
		expect((await bob.request({ action: "list" })).body.connections).toEqual(
			[],
		);
		expect(
			(await bob.request(undefined, { action: "call", address, arguments: {} }))
				.status,
		).toBe(400);
		const other = await client(mf, "personal:other", "alice");
		expect((await other.request({ action: "list" })).body.connections).toEqual(
			[],
		);
		await mf.dispose();
		instances.delete(mf);
		mf = create(directory);
		a = await client(mf);
		expect((await a.request({ action: "list" })).body.connections).toHaveLength(
			1,
		);
		expect(
			(
				await a.request(undefined, {
					action: "call",
					address,
					arguments: { text: "after restart" },
				})
			).status,
		).toBe(200);
		expect(
			(
				await a.request({
					action: "disconnect",
					connectionId: connected.body.connectionId,
				})
			).status,
		).toBe(200);
		expect(
			(await a.request(undefined, { action: "call", address, arguments: {} }))
				.status,
		).toBe(400);
		await mf.dispose();
		instances.delete(mf);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 60_000);
test("OAuth requires owner confirmation and rejects callback replay", async () => {
	const mf = create();
	const a = await client(mf);
	const started = await a.request({
		action: "connect",
		pluginId: "linear",
		label: "Work",
		requestId: crypto.randomUUID(),
	});
	expect(started.status).toBe(200);
	expect(started.body.state).toBe("pending");
	expect(registration).toMatchObject({ client_name: "Zuse" });
	const authorization = new URL(String(started.body.authorizationUrl));
	expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
	const state = authorization.searchParams.get("state") ?? "";
	const callback = await a.vault.fetch(
		`https://internal/callback?state=${encodeURIComponent(state)}&code=one-use-code`,
		{ redirect: "manual" },
	);
	expect(callback.status).toBe(302);
	const ticket = new URL(
		callback.headers.get("location") ?? "",
	).searchParams.get("plugin_ticket");
	expect(
		(await a.request({ action: "poll", attemptId: started.body.id })).body
			.state,
	).toBe("pending");
	const bob = await client(mf, "personal:alice", "bob");
	expect((await bob.request({ action: "complete", ticket })).status).toBe(400);
	const completed = await a.request({ action: "complete", ticket });
	expect(completed.status).toBe(200);
	expect(completed.body.state).toBe("connected");
	expect((await a.request({ action: "complete", ticket })).status).toBe(400);
	expect(
		(
			await a.vault.fetch(
				`https://internal/callback?state=${encodeURIComponent(state)}&code=again`,
			)
		).status,
	).toBe(400);
	const listed = await a.request({ action: "list" });
	expect(JSON.stringify(listed)).not.toContain("private-");
	const search = await a.request(undefined, { action: "search", query: "" });
	expect(search.body).toHaveLength(1);
	expect(
		(
			await a.request(undefined, {
				action: "call",
				address: firstAddress(search.body),
				arguments: { text: "oauth" },
			})
		).status,
	).toBe(200);
	const pending = await a.request({
		action: "connect",
		pluginId: "linear",
		label: "Cancel",
		requestId: crypto.randomUUID(),
	});
	expect(
		(await a.request({ action: "cancel", attemptId: pending.body.id })).body
			.state,
	).toBe("cancelled");
	const stored = await (
		await a.vault.fetch("https://internal/__test/storage")
	).json();
	expect(JSON.stringify(stored)).not.toContain("private-upstream-token");
	expect(JSON.stringify(stored)).not.toContain("private-refresh-token");
	expect(
		(
			await a.request({
				action: "disconnect",
				connectionId: started.body.connectionId,
			})
		).status,
	).toBe(200);
	expect(
		(await a.request(undefined, { action: "search", query: "" })).body,
	).toEqual([]);
	const removed = (await (
		await a.vault.fetch("https://internal/__test/storage")
	).json()) as { rows: Record<string, unknown[]> };
	const accounts = Object.entries(removed.rows).find(([name]) =>
		/accounts$/i.test(name),
	);
	expect(accounts).toBeDefined();
	expect(accounts?.[1]).toEqual([]);
}, 60_000);

async function authorize(a: Awaited<ReturnType<typeof client>>) {
	const started = await a.request({
		action: "connect",
		pluginId: "linear",
		label: "Work",
		requestId: crypto.randomUUID(),
	});
	expect(started.status).toBe(200);
	const state = new URL(String(started.body.authorizationUrl)).searchParams.get(
		"state",
	);
	const callback = await a.vault.fetch(
		`https://internal/callback?state=${encodeURIComponent(state ?? "")}&code=fixture-code`,
		{ redirect: "manual" },
	);
	expect(callback.status).toBe(302);
	return new URL(callback.headers.get("location") ?? "").searchParams.get(
		"plugin_ticket",
	);
}

test("keeps multiple plugin connections independently addressable", async () => {
	const a = await client(create());
	const connect = () =>
		a.request({
			action: "connect",
			pluginId: "cloudflare",
			label: "Docs",
			requestId: crypto.randomUUID(),
		});
	const [first, second] = await Promise.all([connect(), connect()]);
	expect(first.status).toBe(200);
	expect(second.status).toBe(200);
	expect(
		(await a.request(undefined, { action: "search", query: "" })).body,
	).toHaveLength(2);
	expect(
		(
			await a.request({
				action: "disconnect",
				connectionId: first.body.connectionId,
			})
		).status,
	).toBe(200);
	const remaining = await a.request(undefined, { action: "search", query: "" });
	expect(remaining.body).toHaveLength(1);
	expect(firstAddress(remaining.body)).toContain(second.body.connectionId);
	expect(
		(
			await a.request(undefined, {
				action: "call",
				address: firstAddress(remaining.body),
				arguments: { text: "second" },
			})
		).status,
	).toBe(200);
}, 60_000);

test("refreshes expiring OAuth credentials through v2 before invoking", async () => {
	tokenExpiresIn = 1;
	try {
		const a = await client(create());
		const ticket = await authorize(a);
		expect((await a.request({ action: "complete", ticket })).status).toBe(200);
		tokenExpiresIn = 3600;
		const before = refreshes;
		const tools = await a.request(undefined, { action: "search", query: "" });
		expect(tools.status).toBe(200);
		expect(refreshes).toBeGreaterThan(before);
		expect(
			(
				await a.request(undefined, {
					action: "call",
					address: firstAddress(tools.body),
					arguments: {},
				})
			).status,
		).toBe(200);
	} finally {
		tokenExpiresIn = 3600;
	}
}, 60_000);

test("failed token exchange removes the connection and consumes confirmation", async () => {
	const a = await client(create());
	const ticket = await authorize(a);
	failTokenExchange = true;
	try {
		expect((await a.request({ action: "complete", ticket })).status).toBe(400);
	} finally {
		failTokenExchange = false;
	}
	expect((await a.request({ action: "complete", ticket })).status).toBe(400);
	expect((await a.request({ action: "list" })).body.connections).toEqual([]);
	expect(
		(await a.request(undefined, { action: "search", query: "" })).body,
	).toEqual([]);
}, 60_000);

test("cleans SDK setup when the connection reference was not retained", async () => {
	const a = await client(create());
	const connected = await a.request({
		action: "connect",
		pluginId: "cloudflare",
		label: "Docs",
		requestId: crypto.randomUUID(),
	});
	expect(connected.status).toBe(200);
	await a.vault.fetch(
		`https://internal/__test/forget-reference?id=${connected.body.connectionId}`,
	);
	expect(
		(
			await a.request({
				action: "disconnect",
				connectionId: connected.body.connectionId,
			})
		).status,
	).toBe(200);
	expect((await a.request({ action: "list" })).body.connections).toEqual([]);
	const stored = (await (
		await a.vault.fetch("https://internal/__test/storage")
	).json()) as { rows: Record<string, unknown[]> };
	const apps = Object.entries(stored.rows).find(([name]) =>
		/(?:^|_)apps$/.test(name),
	);
	expect(apps).toBeDefined();
	expect(apps?.[1]).toEqual([]);
}, 60_000);
