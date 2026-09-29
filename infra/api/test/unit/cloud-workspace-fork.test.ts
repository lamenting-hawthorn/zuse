import {
	type SandboxProviderAdapter,
	SandboxProviderError,
} from "@zuse/sandbox-providers";
import { Effect } from "effect";
import { describe, expect, test, vi } from "vitest";
import { forkCloudWorkspaceMachine } from "../../src/cloud-workspace-fork.ts";
import {
	type CloudWorkspaceRecord,
	CloudWorkspaceStore,
	CloudWorkspaceStoreMemory,
} from "../../src/cloud-workspace-store.ts";

const source: CloudWorkspaceRecord = {
	workspaceId: "parent",
	accountId: "account",
	projectId: "project",
	buildId: "build",
	provider: "boxd",
	providerSandboxId: "vm-parent",
	runtimeState: "online",
	chatId: "chat-parent",
	initialSessionId: "session-parent",
	branch: "parent",
	baseRef: "main",
	state: "ready",
	desiredState: "ready",
	statusCode: "ready",
	idempotencyKey: "parent",
	requestConfig: {},
	nextActionAtMs: 0,
	revision: 1,
	createdAtMs: 1,
	updatedAtMs: 1,
	lastActivityAtMs: 1,
};
const child: CloudWorkspaceRecord = {
	...source,
	workspaceId: "child",
	providerSandboxId: undefined,
	requestConfig: {
		machineFork: {
			workspaceId: "parent",
			providerSandboxId: "vm-parent",
			chatId: "chat-parent",
			sessionId: "session-parent",
			messageId: "point",
		},
	},
};

describe("cloud machine fork ownership and recovery", () => {
	test.each([
		false,
		true,
	])("persists the source recovery intent before native fork and restores it after failure=%s", async (fail) => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* CloudWorkspaceStore;
				yield* store.saveWorkspace(source);
				const setNetwork = vi.fn(() => Effect.void);
				const provider = {
					forkMachine: () =>
						Effect.gen(function* () {
							expect(
								(yield* store.getWorkspace("parent"))?.requestConfig
									.forkNetworkRestorePending,
							).toBe(true);
							expect(
								(yield* store.getWorkspace("parent"))?.leaseOwner,
							).toBeDefined();
							if (fail)
								return yield* new SandboxProviderError({ code: "transient" });
							return {
								providerSandboxId: "vm-child",
								providerLabel: "child",
								state: "running" as const,
							};
						}),
					setNetwork,
				} as unknown as SandboxProviderAdapter;
				const result = yield* forkCloudWorkspaceMachine(
					child,
					provider,
					"child",
					600,
				).pipe(Effect.result);
				expect(result._tag).toBe(fail ? "Failure" : "Success");
				expect(setNetwork).toHaveBeenCalledWith("vm-parent", { kind: "open" });
				const restored = yield* store.getWorkspace("parent");
				expect(
					restored?.requestConfig.forkNetworkRestorePending,
				).toBeUndefined();
				expect(restored?.leaseOwner).toBeUndefined();
				expect(restored?.runtimeCredentialHash).toBe(
					source.runtimeCredentialHash,
				);
			}).pipe(Effect.provide(CloudWorkspaceStoreMemory)),
		);
	});
	test("rejects cross-account sources without touching their network", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* CloudWorkspaceStore;
				yield* store.saveWorkspace({ ...source, accountId: "other-account" });
				const forkMachine = vi.fn(() => Effect.die("must not fork"));
				const setNetwork = vi.fn(() => Effect.void);
				const result = yield* forkCloudWorkspaceMachine(
					child,
					{ forkMachine, setNetwork } as unknown as SandboxProviderAdapter,
					"child",
					600,
				).pipe(Effect.result);
				expect(result._tag).toBe("Failure");
				expect(forkMachine).not.toHaveBeenCalled();
				expect(setNetwork).not.toHaveBeenCalled();
				expect(
					(yield* store.getWorkspace("parent"))?.leaseOwner,
				).toBeUndefined();
			}).pipe(Effect.provide(CloudWorkspaceStoreMemory)),
		);
	});
	test("retains the durable recovery intent if the parent cannot be reopened", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* CloudWorkspaceStore;
				yield* store.saveWorkspace(source);
				const provider = {
					forkMachine: () =>
						Effect.fail(new SandboxProviderError({ code: "transient" })),
					setNetwork: () =>
						Effect.fail(new SandboxProviderError({ code: "transient" })),
				} as unknown as SandboxProviderAdapter;
				yield* forkCloudWorkspaceMachine(child, provider, "child", 600).pipe(
					Effect.result,
				);
				const parent = yield* store.getWorkspace("parent");
				expect(parent?.requestConfig.forkNetworkRestorePending).toBe(true);
				expect(parent?.leaseOwner).toBeUndefined();
			}).pipe(Effect.provide(CloudWorkspaceStoreMemory)),
		);
	});
	test("does not race another source lifecycle operation", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* CloudWorkspaceStore;
				yield* store.saveWorkspace(source);
				yield* store.claimWorkspace(
					"parent",
					"another-operation",
					Date.now(),
					Date.now() + 60_000,
				);
				const forkMachine = vi.fn(() => Effect.die("must not fork"));
				const result = yield* forkCloudWorkspaceMachine(
					child,
					{ forkMachine } as unknown as SandboxProviderAdapter,
					"child",
					600,
				).pipe(Effect.result);
				expect(result._tag).toBe("Failure");
				expect(forkMachine).not.toHaveBeenCalled();
			}).pipe(Effect.provide(CloudWorkspaceStoreMemory)),
		);
	});
});
