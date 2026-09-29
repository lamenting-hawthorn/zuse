import { afterEach, beforeEach, expect, it, vi } from "vitest";

const storage = { getItem: vi.fn(), setItem: vi.fn() };
beforeEach(() => {
	vi.resetModules();
	vi.resetAllMocks();
	vi.stubGlobal("localStorage", storage);
});
afterEach(() => vi.unstubAllGlobals());
it("defaults off and remembers opt-in independently for each workspace", async () => {
	storage.getItem.mockReturnValue(null);
	const { usePreviewSettings, DEFAULT_PREVIEW_SETTINGS } = await import(
		"../../src/store/preview-settings.ts"
	);
	expect(DEFAULT_PREVIEW_SETTINGS).toEqual({
		publish: false,
		forward: false,
		ports: [],
		publishedPorts: [],
		revocationPending: false,
	});
	usePreviewSettings
		.getState()
		.update("persian", { publish: true, ports: [3001] });
	usePreviewSettings.getState().update("pikachu", { forward: true });
	expect(usePreviewSettings.getState().environments.persian).toEqual({
		publish: true,
		forward: false,
		ports: [3001],
		publishedPorts: [],
		revocationPending: false,
	});
	expect(JSON.parse(storage.setItem.mock.calls.at(-1)?.[1])).toEqual({
		persian: {
			publish: true,
			forward: false,
			ports: [3001],
			publishedPorts: [],
			revocationPending: false,
		},
		pikachu: {
			publish: false,
			forward: true,
			ports: [],
			publishedPorts: [],
			revocationPending: false,
		},
	});
});
it("restores preferences and rejects reserved, malformed and out-of-range ports", async () => {
	storage.getItem.mockReturnValue(
		JSON.stringify({
			persian: {
				publish: true,
				forward: true,
				ports: [3001, "3002", 22, 47837, 65536, 1.5],
			},
			broken: { publish: "yes" },
		}),
	);
	const { usePreviewSettings } = await import(
		"../../src/store/preview-settings.ts"
	);
	expect(usePreviewSettings.getState().environments).toEqual({
		persian: {
			publish: true,
			forward: true,
			ports: [3001],
			publishedPorts: [3001],
			revocationPending: true,
		},
	});
});

it("refuses a required publication journal write when storage fails", async () => {
	storage.getItem.mockReturnValue(null);
	const { usePreviewSettings } = await import(
		"../../src/store/preview-settings.ts"
	);
	storage.setItem.mockImplementation(() => {
		throw new Error("quota exceeded");
	});
	expect(() =>
		usePreviewSettings
			.getState()
			.update("persian", { publishedPorts: [3001] }, true),
	).toThrow("quota exceeded");
	expect(usePreviewSettings.getState().environments.persian).toBeUndefined();
});
