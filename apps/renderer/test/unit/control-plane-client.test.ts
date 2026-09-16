import { Effect } from "effect";
import { beforeEach, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/rpc-client.ts", () => ({
	getControlPlaneRpcClient: connection,
}));

import { runControlPlane } from "../../src/lib/control-plane-client.ts";
import { observeRendererAccount } from "../../src/lib/renderer-account.ts";

beforeEach(() => {
	connection.mockReset().mockResolvedValue({});
	observeRendererAccount(null);
	observeRendererAccount("alice");
});

it("does not dispatch a waiting operation under a replacement account", async () => {
	const ready = Promise.withResolvers<object>();
	connection.mockReturnValue(ready.promise);
	const operation = vi.fn(() => Effect.succeed("result"));
	const pending = runControlPlane(operation);
	observeRendererAccount("bob");
	ready.resolve({});
	await expect(pending).rejects.toThrow("connection account changed");
	expect(operation).not.toHaveBeenCalled();
});

it("does not publish an old result after switching away and back", async () => {
	const result = Promise.withResolvers<string>();
	const operation = vi.fn(() => Effect.promise(() => result.promise));
	const pending = runControlPlane(operation);
	await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
	observeRendererAccount("bob");
	observeRendererAccount("alice");
	result.resolve("alice's old result");
	await expect(pending).rejects.toThrow("connection account changed");
});

it("keeps ordinary same-account refreshes and errors unchanged", async () => {
	const pending = runControlPlane(() => Effect.succeed("result"));
	observeRendererAccount("alice");
	await expect(pending).resolves.toBe("result");
	await expect(
		runControlPlane(() => Effect.fail(new Error("provider unavailable"))),
	).rejects.toThrow("provider unavailable");
});

it("does not require authentication for existing signed-out control-plane calls", async () => {
	observeRendererAccount(null);
	await expect(runControlPlane(() => Effect.succeed("status"))).resolves.toBe(
		"status",
	);
});
