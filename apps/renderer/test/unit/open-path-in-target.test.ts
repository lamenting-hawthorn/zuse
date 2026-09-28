import { beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
	revealPath: vi.fn(),
	openPathInApp: vi.fn(),
}));
vi.mock("../../src/lib/bridge.ts", () => ({ getAppBridge: () => bridge }));

import { openPathInTarget } from "../../src/lib/open-path-in-target.ts";

beforeEach(() => vi.resetAllMocks());
it("reveals the exact synced folder in Finder", async () => {
	await openPathInTarget("/Users/me/sync/my repo", "finder");
	expect(bridge.revealPath).toHaveBeenCalledWith("/Users/me/sync/my repo");
	expect(bridge.openPathInApp).not.toHaveBeenCalled();
});
it("opens the exact synced folder in the selected app", async () => {
	await openPathInTarget("/Users/me/sync/my repo", "cursor");
	expect(bridge.openPathInApp).toHaveBeenCalledWith(
		"/Users/me/sync/my repo",
		"cursor",
	);
	expect(bridge.revealPath).not.toHaveBeenCalled();
});
it("propagates launch failure for the menu to display", async () => {
	bridge.openPathInApp.mockRejectedValue(new Error("App unavailable"));
	await expect(openPathInTarget("/sync/repo", "zed")).rejects.toThrow(
		"App unavailable",
	);
});
