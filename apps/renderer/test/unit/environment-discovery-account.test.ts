import { Effect } from "effect";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	connect: vi.fn(),
	subscribe: vi.fn(),
	remove: vi.fn(async () => undefined),
	setActive: vi.fn(),
	release: vi.fn(),
	unsubscribe: vi.fn(),
}));
vi.mock("../../src/lib/rpc-client.ts", async (original) => ({
	...(await original<typeof import("../../src/lib/rpc-client.ts")>()),
	removeRendererEnvironment: mocks.remove,
	setActiveEnvironment: mocks.setActive,
}));
vi.mock("../../src/lib/environment-shell-client-bus.ts", async (original) => ({
	...(await original<
		typeof import("../../src/lib/environment-shell-client-bus.ts")
	>()),
	retainEnvironmentShell: () => ({
		lease: { release: mocks.release, activate: () => undefined },
	}),
	subscribeEnvironmentShell: mocks.subscribe,
	environmentShellSnapshot: () => ({ data: null, connection: "dormant" }),
}));
vi.mock("../../src/lib/runtime-operation-client.ts", () => ({
	runtimeOperationClient: async () => ({
		"environments.list": mocks.list,
		"environments.connect": mocks.connect,
	}),
}));

import { observeRendererAccount } from "../../src/lib/renderer-account.ts";
import {
	type EnvironmentCatalogEntry,
	useEnvironmentCatalogStore,
} from "../../src/store/environment-catalog.ts";
import { useWorkspaceStore } from "../../src/store/workspace.ts";

const local: EnvironmentCatalogEntry = {
	connectionKind: "local",
	environmentId: "local",
	profileId: null,
	label: "Local",
	target: null,
	descriptor: null,
	status: "connected",
	error: null,
};
const ssh: EnvironmentCatalogEntry = {
	...local,
	connectionKind: "ssh",
	environmentId: "manual",
	profileId: "manual-profile",
};
const deferred = () => {
	let resolve!: (value: {
		environments: Array<{ environmentId: string; label: string }>;
	}) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<{
		environments: Array<{ environmentId: string; label: string }>;
	}>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
};

beforeEach(() => {
	useEnvironmentCatalogStore.setState({ initialized: false });
	observeRendererAccount(null);
	observeRendererAccount("first");
	useEnvironmentCatalogStore.setState({
		entries: [local, ssh],
		initialized: false,
		accountDiscoveryError: null,
		activeEnvironmentId: "local",
	});
	mocks.remove.mockClear();
	mocks.setActive.mockClear();
	mocks.release.mockClear();
	mocks.unsubscribe.mockClear();
	mocks.subscribe.mockReset().mockImplementation(() => mocks.unsubscribe);
	mocks.connect.mockReset().mockImplementation(() =>
		Effect.succeed({
			endpoint: { wsBaseUrl: "wss://example.test/rpc" },
			connectToken: "test-token",
		}),
	);
	mocks.list
		.mockReset()
		.mockImplementation(() => Effect.succeed({ environments: [] }));
});

it("clears account entries and releases their subscriptions without removing device profiles", async () => {
	mocks.list.mockImplementationOnce(() =>
		Effect.succeed({
			environments: [
				{ environmentId: "account-server", label: "Account server" },
			],
		}),
	);
	await useEnvironmentCatalogStore.getState().syncAccountEnvironments();
	expect(useEnvironmentCatalogStore.getState().entries).toHaveLength(3);
	observeRendererAccount("first");
	expect(mocks.release).not.toHaveBeenCalled();
	observeRendererAccount(null);
	expect(useEnvironmentCatalogStore.getState().entries).toEqual([local, ssh]);
	expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("account-server");
	expect(mocks.release).toHaveBeenCalledOnce();
	expect(mocks.unsubscribe).toHaveBeenCalledOnce();
});

it("refreshes the initialized catalog for a newly signed-in account, but not on sign-out", async () => {
	useEnvironmentCatalogStore.setState({ initialized: true });
	observeRendererAccount("second");
	await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
	observeRendererAccount(null);
	await Promise.resolve();
	expect(mocks.list).toHaveBeenCalledOnce();
	expect(useEnvironmentCatalogStore.getState().entries).toEqual([local, ssh]);
});

it("reconciles successful discovery removals and clears the active remote projection", async () => {
	mocks.list.mockImplementationOnce(() =>
		Effect.succeed({
			environments: [
				{ environmentId: "account-server", label: "Account server" },
			],
		}),
	);
	await useEnvironmentCatalogStore.getState().syncAccountEnvironments();
	useEnvironmentCatalogStore.setState({
		activeEnvironmentId: "account-server",
	});
	await useEnvironmentCatalogStore.getState().syncAccountEnvironments();
	expect(useEnvironmentCatalogStore.getState().entries).toEqual([local, ssh]);
	expect(useEnvironmentCatalogStore.getState().activeEnvironmentId).toBe(
		"local",
	);
	expect(mocks.setActive).toHaveBeenLastCalledWith("local");
	expect(useWorkspaceStore.getState().selectedFolderId).toBeNull();
	expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("account-server");
	await useEnvironmentCatalogStore.getState().syncAccountEnvironments();
	expect(mocks.remove).toHaveBeenCalledOnce();
});

it("cancels a pending remote activation when account access is removed", async () => {
	mocks.list.mockImplementationOnce(() =>
		Effect.succeed({
			environments: [
				{ environmentId: "account-server", label: "Account server" },
			],
		}),
	);
	await useEnvironmentCatalogStore.getState().syncAccountEnvironments();
	const pending = useEnvironmentCatalogStore
		.getState()
		.activate("account-server");
	const rejected = expect(pending).rejects.toThrow(
		"Environment subscription was removed",
	);
	await vi.waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(2));
	observeRendererAccount(null);
	await rejected;
	expect(useEnvironmentCatalogStore.getState().activeEnvironmentId).toBe(
		"local",
	);
	expect(mocks.release).toHaveBeenCalledOnce();
	expect(mocks.unsubscribe).toHaveBeenCalledTimes(2);
});

it.each([
	false,
	true,
])("ignores stale discovery after A -> B -> A (failure: %s)", async (failure) => {
	const old = deferred();
	mocks.list.mockImplementationOnce(() =>
		Effect.tryPromise({ try: () => old.promise, catch: (cause) => cause }),
	);
	const pending = useEnvironmentCatalogStore
		.getState()
		.syncAccountEnvironments();
	await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
	observeRendererAccount("second");
	observeRendererAccount("first");
	if (failure) old.reject(new Error("old account failure"));
	else
		old.resolve({
			environments: [{ environmentId: "old-private", label: "Private" }],
		});
	await pending;
	expect(useEnvironmentCatalogStore.getState().entries).toEqual([local, ssh]);
	expect(
		useEnvironmentCatalogStore.getState().accountDiscoveryError,
	).toBeNull();
});

it("does not let an older same-account refresh supersede a newer response", async () => {
	const old = deferred();
	mocks.list.mockImplementationOnce(() => Effect.promise(() => old.promise));
	const pending = useEnvironmentCatalogStore
		.getState()
		.syncAccountEnvironments();
	await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
	await useEnvironmentCatalogStore.getState().syncAccountEnvironments();
	old.resolve({
		environments: [{ environmentId: "removed-server", label: "Old" }],
	});
	await pending;
	expect(useEnvironmentCatalogStore.getState().entries).toEqual([local, ssh]);
});

it("still reports a failure from the current discovery request", async () => {
	mocks.list.mockImplementation(() =>
		Effect.fail(new Error("current lookup failed")),
	);
	await expect(
		useEnvironmentCatalogStore.getState().syncAccountEnvironments(),
	).rejects.toThrow("current lookup failed");
	expect(useEnvironmentCatalogStore.getState().entries).toEqual([local, ssh]);
});
