import { beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("../../src/lib/session-timeline-cache.ts", () => ({
	cloudChatCatalogPersistence: persistence,
}));

import {
	hydrateCloudChatCatalogPersistence,
	useCloudChatCatalogStore,
} from "../../src/lib/cloud-workspace-catalog.ts";
import { observeRendererAccount } from "../../src/lib/renderer-account.ts";
import { selectRendererWorkspace } from "../../src/lib/renderer-workspace.ts";

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const catalog = (owner: string) => ({
	syncPrefs: { [owner]: { enabled: true } },
});

describe("account-scoped cloud catalog", () => {
	beforeEach(() => {
		observeRendererAccount(null);
		persistence.load
			.mockReset()
			.mockImplementation(async (subject: string) => catalog(subject));
		persistence.save.mockReset().mockResolvedValue(undefined);
	});

	it("waits for an account, separates owners, and clears on sign-out", async () => {
		await hydrateCloudChatCatalogPersistence();
		expect(persistence.load).not.toHaveBeenCalled();
		observeRendererAccount("first");
		await hydrateCloudChatCatalogPersistence();
		expect(useCloudChatCatalogStore.getState().syncPrefs).toEqual(
			catalog("first").syncPrefs,
		);
		observeRendererAccount("first");
		await hydrateCloudChatCatalogPersistence();
		expect(persistence.load).toHaveBeenCalledTimes(1);
		observeRendererAccount("second");
		expect(useCloudChatCatalogStore.getState().syncPrefs).toEqual({});
		await hydrateCloudChatCatalogPersistence();
		expect(useCloudChatCatalogStore.getState().syncPrefs).toEqual(
			catalog("second").syncPrefs,
		);
		observeRendererAccount(null);
		expect(useCloudChatCatalogStore.getState().syncPrefs).toEqual({});
	});

	it.each([
		false,
		true,
	])("ignores a late load after switching accounts (return to first: %s)", async (returnToFirst) => {
		const old = deferred<unknown>();
		persistence.load.mockImplementationOnce(() => old.promise);
		observeRendererAccount("first");
		const initial = hydrateCloudChatCatalogPersistence();
		await vi.waitFor(() =>
			expect(persistence.load).toHaveBeenCalledWith("first"),
		);
		observeRendererAccount("second");
		await hydrateCloudChatCatalogPersistence();
		if (returnToFirst) {
			observeRendererAccount("first");
			await hydrateCloudChatCatalogPersistence();
		}
		old.resolve(catalog("stale"));
		await initial;
		expect(useCloudChatCatalogStore.getState().syncPrefs).toEqual(
			catalog(returnToFirst ? "first" : "second").syncPrefs,
		);
	});

	it("keeps delayed saves bound to their original owner", async () => {
		observeRendererAccount("first");
		await hydrateCloudChatCatalogPersistence();
		const gate = deferred<void>();
		persistence.save.mockImplementationOnce(() => gate.promise);
		useCloudChatCatalogStore.setState(catalog("first-edit"));
		await vi.waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(2));
		observeRendererAccount("second");
		const next = hydrateCloudChatCatalogPersistence();
		expect(useCloudChatCatalogStore.getState().syncPrefs).toEqual({});
		gate.resolve();
		await next;
		expect(persistence.save.mock.calls[1]?.[0]).toBe("first");
		expect(persistence.save.mock.calls[1]?.[1].syncPrefs).toEqual(
			catalog("first-edit").syncPrefs,
		);
		expect(persistence.save.mock.calls.at(-1)?.[0]).toBe("second");
		expect(useCloudChatCatalogStore.getState().syncPrefs).toEqual(
			catalog("second").syncPrefs,
		);
	});

	it("preserves Personal cache keys and separates each organization", async () => {
		observeRendererAccount("alice");
		await hydrateCloudChatCatalogPersistence();
		expect(persistence.load).toHaveBeenLastCalledWith("alice");
		for (const organizationId of ["org_a", "org_b"]) {
			selectRendererWorkspace({ kind: "organization", organizationId });
			expect(useCloudChatCatalogStore.getState().syncPrefs).toEqual({});
			await hydrateCloudChatCatalogPersistence();
			const key = JSON.stringify(["alice", `organization:${organizationId}`]);
			expect(persistence.load).toHaveBeenLastCalledWith(key);
			expect(useCloudChatCatalogStore.getState().syncPrefs).toEqual(
				catalog(key).syncPrefs,
			);
		}
		selectRendererWorkspace({ kind: "personal" });
		await hydrateCloudChatCatalogPersistence();
		expect(useCloudChatCatalogStore.getState().syncPrefs).toEqual(
			catalog("alice").syncPrefs,
		);
	});

	it("ignores a late organization load after switching away and back", async () => {
		observeRendererAccount("alice");
		await hydrateCloudChatCatalogPersistence();
		const old = deferred<unknown>();
		persistence.load.mockImplementationOnce(() => old.promise);
		selectRendererWorkspace({ kind: "organization", organizationId: "org_a" });
		const initial = hydrateCloudChatCatalogPersistence();
		await vi.waitFor(() =>
			expect(persistence.load).toHaveBeenLastCalledWith(
				JSON.stringify(["alice", "organization:org_a"]),
			),
		);
		selectRendererWorkspace({ kind: "personal" });
		await hydrateCloudChatCatalogPersistence();
		selectRendererWorkspace({ kind: "organization", organizationId: "org_a" });
		await hydrateCloudChatCatalogPersistence();
		old.resolve(catalog("stale"));
		await initial;
		expect(useCloudChatCatalogStore.getState().syncPrefs).toEqual(
			catalog(JSON.stringify(["alice", "organization:org_a"])).syncPrefs,
		);
	});
});
