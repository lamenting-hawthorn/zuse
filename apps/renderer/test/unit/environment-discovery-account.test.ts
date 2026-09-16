import { Effect } from "effect";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../src/lib/runtime-operation-client.ts", () => ({
	runtimeOperationClient: async () => ({ "environments.list": mocks.list }),
}));

import { observeRendererAccount } from "../../src/lib/renderer-account.ts";
import {
	type EnvironmentCatalogEntry,
	useEnvironmentCatalogStore,
} from "../../src/store/environment-catalog.ts";

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
	observeRendererAccount("first");
	useEnvironmentCatalogStore.setState({
		entries: [local, ssh],
		initialized: true,
		accountDiscoveryError: null,
	});
	mocks.list
		.mockReset()
		.mockImplementation(() => Effect.succeed({ environments: [] }));
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
