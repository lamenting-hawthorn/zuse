import { bundledResolvedModelCatalog, EnvironmentId } from "@zuse/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	activeEnvironmentId: "local",
	dispatch: vi.fn(),
}));

vi.mock("../../src/lib/environment-shell-client-bus.ts", () => ({
	dispatchEnvironmentShellCommand: mocks.dispatch,
}));

vi.mock("../../src/store/environment-catalog.ts", () => ({
	useEnvironmentCatalogStore: {
		getState: () => ({ activeEnvironmentId: mocks.activeEnvironmentId }),
	},
}));

const { resetModelCatalogForEnvironment, useModelCatalogStore } = await import(
	"../../src/store/model-catalog.ts"
);

describe("model catalog cache", () => {
	beforeEach(() => {
		mocks.activeEnvironmentId = "local";
		mocks.dispatch.mockReset();
		resetModelCatalogForEnvironment();
	});

	it("loads once per environment", async () => {
		mocks.dispatch.mockResolvedValue({ result: bundledResolvedModelCatalog() });

		await useModelCatalogStore.getState().ensureLoaded();
		await useModelCatalogStore.getState().ensureLoaded();
		expect(mocks.dispatch).toHaveBeenCalledTimes(1);

		mocks.activeEnvironmentId = "remote";
		await useModelCatalogStore.getState().ensureLoaded();
		expect(mocks.dispatch).toHaveBeenCalledTimes(2);
		expect(useModelCatalogStore.getState().loadedEnvironmentId).toBe("remote");
	});

	it("retries after a failed load", async () => {
		mocks.dispatch
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({ result: bundledResolvedModelCatalog() });

		await useModelCatalogStore.getState().ensureLoaded();
		expect(useModelCatalogStore.getState().loadedEnvironmentId).toBeNull();

		await useModelCatalogStore.getState().ensureLoaded();
		expect(mocks.dispatch).toHaveBeenCalledTimes(2);
		expect(useModelCatalogStore.getState().loadedEnvironmentId).toBe("local");
	});

	it("applies catalogs pushed after the initial load", async () => {
		const initial = bundledResolvedModelCatalog();
		mocks.dispatch.mockResolvedValue({ result: initial });
		await useModelCatalogStore.getState().ensureLoaded();

		const pushed = { ...initial, revision: initial.revision + 1 };
		useModelCatalogStore
			.getState()
			.receive(EnvironmentId.make("local"), pushed);
		expect(useModelCatalogStore.getState().catalog).toEqual(pushed);
		expect(mocks.dispatch).toHaveBeenCalledTimes(1);
	});

	it("ignores pushed catalogs for an inactive environment", () => {
		const before = useModelCatalogStore.getState().catalog;
		useModelCatalogStore.getState().receive(EnvironmentId.make("remote"), {
			...before,
			revision: before.revision + 1,
		});
		expect(useModelCatalogStore.getState().catalog).toBe(before);
		expect(useModelCatalogStore.getState().loadedEnvironmentId).toBeNull();
	});

	it("keeps a pushed catalog over a fetch that started before it", async () => {
		const initial = bundledResolvedModelCatalog();
		let resolveFetch: (value: { result: typeof initial }) => void = () => {};
		mocks.dispatch.mockReturnValue(
			new Promise((resolve) => {
				resolveFetch = resolve;
			}),
		);
		const load = useModelCatalogStore.getState().ensureLoaded();

		const pushed = { ...initial, revision: initial.revision + 2 };
		useModelCatalogStore
			.getState()
			.receive(EnvironmentId.make("local"), pushed);
		resolveFetch({ result: { ...initial, revision: initial.revision + 1 } });
		await load;

		expect(useModelCatalogStore.getState().catalog).toEqual(pushed);
		expect(useModelCatalogStore.getState().loading).toBe(false);
	});
});
