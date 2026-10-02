import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../src/lib/rpc-client.ts", async (original) => ({
	...(await original<typeof import("../../src/lib/rpc-client.ts")>()),
	getControlPlaneRpcClient: async () => ({ "cloud.chats.list": mocks.list }),
}));
vi.mock("../../src/lib/session-timeline-cache.ts", async (original) => ({
	...(await original<
		typeof import("../../src/lib/session-timeline-cache.ts")
	>()),
	cloudChatCatalogPersistence: {
		load: async () => null,
		save: async () => undefined,
	},
}));

import { useCloudChatsStore } from "../../src/lib/cloud-workspaces.ts";
import { observeRendererAccount } from "../../src/lib/renderer-account.ts";

const deferred = () => {
	let resolve!: (value: { chats: [] }) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<{ chats: [] }>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
};

describe("cloud catalog refresh account fence", () => {
	beforeEach(() => {
		observeRendererAccount(null);
		mocks.list
			.mockReset()
			.mockImplementation(() => Effect.succeed({ chats: [] }));
	});

	it("does not load an account catalog before sign-in", async () => {
		await useCloudChatsStore.getState().hydrate();
		expect(mocks.list).not.toHaveBeenCalled();
	});

	it.each([
		false,
		true,
	])("ignores an old account completion without clearing the new refresh (failure: %s)", async (failure) => {
		const first = deferred();
		const second = deferred();
		mocks.list
			.mockImplementationOnce(() =>
				Effect.tryPromise({
					try: () => first.promise,
					catch: (cause) => cause,
				}),
			)
			.mockImplementationOnce(() => Effect.promise(() => second.promise));
		observeRendererAccount("first");
		const old = useCloudChatsStore.getState().hydrate();
		await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
		observeRendererAccount("second");
		const current = useCloudChatsStore.getState().hydrate();
		await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
		if (failure) first.reject(new Error("old account unavailable"));
		else first.resolve({ chats: [] });
		await old;
		expect(useCloudChatsStore.getState()).toMatchObject({
			loading: true,
			error: null,
		});
		const duplicate = useCloudChatsStore.getState().hydrate();
		second.resolve({ chats: [] });
		await Promise.all([current, duplicate]);
		expect(mocks.list).toHaveBeenCalledTimes(2);
		expect(useCloudChatsStore.getState()).toMatchObject({
			loading: false,
			error: null,
		});
	});
});
