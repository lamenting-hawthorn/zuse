import { Effect, Layer } from "effect";
import { expect, it, vi } from "vitest";
import { CloudWorkspaceStoreMemory } from "../../src/cloud-workspace-store.ts";
import { routeModelConnectionRequest } from "../../src/model-connection-routes.ts";
import { ModelConnectionStore } from "../../src/model-connection-store.ts";
import { ApiStoreMemory } from "../../src/store.ts";
import { WorkosVerifierTest } from "../../src/workos.ts";

const write = vi.fn(async () => {});
const layer = Layer.mergeAll(
	WorkosVerifierTest,
	ApiStoreMemory,
	CloudWorkspaceStoreMemory,
	Layer.succeed(ModelConnectionStore, {
		acquire: async () => true,
		release: async () => {},
		read: async () => null,
		list: async () => [],
		write,
		removeAccount: async () => {},
	}),
);
it.each([
	{ action: "list" },
	{ action: "read", kind: "active" },
	{ action: "write", kind: "active", id: "one" },
])("returns 400 for incomplete storage commands: %j", async (body) => {
	const result = await Effect.runPromise(
		routeModelConnectionRequest(
			new Request("https://api.test/v1/model-connections/storage", {
				method: "POST",
				headers: {
					authorization: "Bearer test-token:account",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					provider: "supergrok",
					token: "a".repeat(16),
					...body,
				}),
			}),
		).pipe(Effect.provide(layer), Effect.result),
	);
	expect(result).toMatchObject({
		_tag: "Failure",
		failure: { status: 400, code: "invalid_request" },
	});
	expect(write).not.toHaveBeenCalled();
});
