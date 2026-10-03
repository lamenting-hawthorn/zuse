import { Effect, Layer, Redacted } from "effect";
import { expect, test, vi } from "vitest";
import { CloudWorkspaceStoreMemory } from "../../src/cloud-workspace-store.ts";
import { layer as configurationLayer } from "../../src/config.ts";
import { PluginHost } from "../../src/plugin-host.ts";
import { routePluginRequest } from "../../src/plugin-routes.ts";
import { WorkosVerifierTest } from "../../src/workos.ts";

const requestHost = vi.fn(async () => ({ kind: "ok" as const }));
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
