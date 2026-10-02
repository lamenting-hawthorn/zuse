import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../src/lib/platform-capabilities.ts", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../../src/lib/platform-capabilities.ts")
	>()),
	isHostedProduct: () => true,
}));

import { useBrowserDevicePreferences } from "../../src/lib/browser-device-preferences.ts";
import {
	keybindingsSnapshot,
	setUserKeybindings,
	subscribeKeybindings,
} from "../../src/lib/keybindings-client-bus.ts";
import { observeRendererAccount } from "../../src/lib/renderer-account.ts";
import { selectRendererWorkspace } from "../../src/lib/renderer-workspace.ts";
import {
	getRendererClientBus,
	resetSessionTimelineClientBusForTest,
} from "../../src/lib/session-timeline-client-bus.ts";

beforeEach(() => {
	useBrowserDevicePreferences.setState({}, true);
	vi.stubGlobal("window", { localStorage: { setItem: vi.fn() } });
});
afterEach(() => {
	resetSessionTimelineClientBusForTest();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("persists shortcuts locally without a runtime and retains them across workspace/account switches", async () => {
	const dispatch = vi.spyOn(getRendererClientBus(), "dispatch");
	const listener = vi.fn();
	const unsubscribe = subscribeKeybindings(listener);
	try {
		await setUserKeybindings([{ key: "ctrl+k", command: "new-chat" }]);
		expect(listener).toHaveBeenCalledOnce();
		expect(window.localStorage.setItem).toHaveBeenCalledOnce();
		observeRendererAccount("alice");
		selectRendererWorkspace({ kind: "organization", organizationId: "org_a" });
		observeRendererAccount("bob");
		expect(keybindingsSnapshot().userRules).toEqual([
			{ key: "ctrl+k", command: "new-chat" },
		]);
		expect(
			keybindingsSnapshot().resolvedRules.some(
				({ rule }) => rule.key === "ctrl+k" && rule.command === "new-chat",
			),
		).toBe(true);
		expect(dispatch).not.toHaveBeenCalled();
	} finally {
		unsubscribe();
	}
});

it("keeps the last saved shortcuts when storage fails", async () => {
	await setUserKeybindings([{ key: "ctrl+k", command: "new-chat" }]);
	vi.mocked(window.localStorage.setItem).mockImplementationOnce(() => {
		throw new Error("quota");
	});
	await expect(setUserKeybindings([])).rejects.toThrow("quota");
	expect(keybindingsSnapshot().userRules).toHaveLength(1);
});
