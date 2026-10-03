import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import { Effect, Layer, Redacted } from "effect";
import { expect, test, vi } from "vitest";
import { CloudWorkspaceStoreMemory } from "../../src/cloud-workspace-store.ts";
import { layer as configurationLayer } from "../../src/config.ts";
import { PluginHost, PluginOperationError } from "../../src/plugin-host.ts";
import { makeCloudflarePluginHost } from "../../src/plugin-host-cloudflare.ts";
import { routePluginRequest } from "../../src/plugin-routes.ts";
import { WorkosVerifierTest } from "../../src/workos.ts";

const requestHost = vi.fn(
	async (..._args: unknown[]): Promise<{ kind: "ok" }> => ({ kind: "ok" }),
);
const layer = Layer.mergeAll(
	configurationLayer({
		apiIssuer: "https://api.test",
		workosJwksUrl: "https://unused.test",
		workosIssuer: "https://unused.test",
		mintPrivateKey: Redacted.make("unused"),
		mintPublicKey: "unused",
		allowedBrowserOrigins: ["https://code.test"],
	}),
	WorkosVerifierTest,
	CloudWorkspaceStoreMemory,
	Layer.succeed(PluginHost, {
		request: requestHost,
		tools: async () => [],
		callback: async () => new Response("callback"),
	}),
);
const send = (
	body: unknown,
	authorization?: string,
	origin?: string,
	path = "/v1/plugins",
) =>
	Effect.runPromise(
		routePluginRequest(
			new Request(`https://api.test${path}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(authorization ? { authorization } : {}),
					...(origin ? { origin } : {}),
				},
				body: JSON.stringify(body),
			}),
		).pipe(Effect.provide(layer), Effect.result),
	);
test("management rejects missing auth and another tenant before reaching storage", async () => {
	requestHost.mockClear();
	expect((await send({ action: "list" }))._tag).toBe("Failure");
	expect(
		(
			await send(
				{ action: "list", tenantId: "personal:bob" },
				"Bearer test-token:alice",
			)
		)._tag,
	).toBe("Failure");
	expect(requestHost).not.toHaveBeenCalled();
});
test("rejects an untrusted browser origin and invalid runtime credentials", async () => {
	requestHost.mockClear();
	expect(
		(
			await send(
				{ action: "list" },
				"Bearer test-token:alice",
				"https://evil.test",
			)
		)._tag,
	).toBe("Failure");
	expect(
		(
			await send(
				{ action: "search", query: "" },
				"Bearer invalid",
				undefined,
				"/v1/plugins/runtime/workspace/tools",
			)
		)._tag,
	).toBe("Failure");
	expect(requestHost).not.toHaveBeenCalled();
});

test("binds personal and organization requests to the verified subject", async () => {
	requestHost.mockClear();
	expect((await send({ action: "list" }, "Bearer test-token:alice"))._tag).toBe(
		"Success",
	);
	expect(requestHost).toHaveBeenLastCalledWith(
		{ tenant: "personal:alice", subject: "alice" },
		{ action: "list" },
	);
	expect(
		(
			await send(
				{ action: "list", tenantId: "organization:team" },
				"Bearer test-token:alice:team",
			)
		)._tag,
	).toBe("Success");
	expect(requestHost).toHaveBeenLastCalledWith(
		{ tenant: "organization:team", subject: "alice" },
		{ action: "list", tenantId: "organization:team" },
	);
});

test("rejects oversized chunked requests before dispatch", async () => {
	requestHost.mockClear();
	expect(
		(
			await send(
				{ action: "connect", label: "x".repeat(130_000) },
				"Bearer test-token:alice",
			)
		)._tag,
	).toBe("Failure");
	expect(requestHost).not.toHaveBeenCalled();
});

test("surfaces readable plugin failure codes and hides other failures", async () => {
	requestHost.mockRejectedValueOnce(
		new PluginOperationError({
			code: "plugin_client_registration_unsupported",
		}),
	);
	const connect = {
		action: "connect",
		tenantId: "personal:alice",
		pluginId: "github",
		label: "GitHub",
		requestId: crypto.randomUUID(),
		returnTo: { kind: "desktop", port: 8976 },
	};
	const failed = await send(connect, "Bearer test-token:alice");
	expect(failed._tag === "Failure" && failed.failure).toMatchObject({
		code: "plugin_client_registration_unsupported",
		status: 400,
	});
	requestHost.mockRejectedValueOnce(new Error("upstream detail"));
	const opaque = await send(connect, "Bearer test-token:alice");
	expect(opaque._tag === "Failure" && opaque.failure).toMatchObject({
		code: "plugin_operation_failed",
	});
	requestHost.mockClear();
	const port = await send(
		{ ...connect, returnTo: { kind: "desktop", port: 8080 } },
		"Bearer test-token:alice",
	);
	expect(port._tag === "Failure" && port.failure).toMatchObject({
		code: "invalid_plugin_request",
	});
	expect(requestHost).not.toHaveBeenCalled();
});

test("the Durable Object host forwards only known failure codes", async () => {
	const host = (error: string) =>
		makeCloudflarePluginHost({
			idFromName: () => ({}),
			get: () => ({
				fetch: async () => Response.json({ error }, { status: 400 }),
			}),
		} as unknown as DurableObjectNamespace);
	const identity = { tenant: "personal:alice", subject: "alice" };
	await expect(
		host("plugin_unreachable").request(identity, { action: "list" }),
	).rejects.toEqual(new PluginOperationError({ code: "plugin_unreachable" }));
	await expect(
		host("secret upstream detail").request(identity, { action: "list" }),
	).rejects.toEqual(
		new PluginOperationError({ code: "plugin_operation_failed" }),
	);
});
