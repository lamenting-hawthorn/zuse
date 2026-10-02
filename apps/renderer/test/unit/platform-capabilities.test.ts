import { describe, expect, it, vi } from "vitest";

import {
	attachmentUrl,
	copyText,
	openExternal,
	rendererPlatformCapabilities,
} from "../../src/lib/platform-capabilities.ts";

describe("renderer platform capabilities", () => {
	it("reserves a browser tab before awaiting checkout and isolates the external page", async () => {
		const url = Promise.withResolvers<string>();
		const meta = {};
		const tab = {
			opener: {},
			closed: false,
			document: { createElement: vi.fn(() => meta), head: { append: vi.fn() } },
			location: { replace: vi.fn() },
			close: vi.fn(),
		};
		const open = vi.fn(() => tab);
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { open },
		});
		const pending = openExternal(() => url.promise);
		expect(open).toHaveBeenCalledWith("", "_blank");
		expect(tab.opener).toBeNull();
		expect(meta).toEqual({ name: "referrer", content: "no-referrer" });
		expect(tab.location.replace).not.toHaveBeenCalled();
		url.resolve("https://billing.example/checkout");
		await pending;
		expect(tab.location.replace).toHaveBeenCalledWith(
			"https://billing.example/checkout",
		);
		expect(tab.close).not.toHaveBeenCalled();
	});

	it("closes the reserved tab when authorization or workspace fencing fails", async () => {
		const tab = {
			opener: {},
			document: { createElement: () => ({}), head: { append: vi.fn() } },
			location: { replace: vi.fn() },
			close: vi.fn(),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { open: () => tab },
		});
		await expect(
			openExternal(async () => {
				throw new Error("workspace changed");
			}),
		).rejects.toThrow("workspace changed");
		expect(tab.close).toHaveBeenCalledOnce();
		expect(tab.location.replace).not.toHaveBeenCalled();
	});

	it("does not start checkout when the browser blocks the new tab", async () => {
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { open: () => null },
		});
		const resolveUrl = vi.fn(async () => "https://billing.example/checkout");
		await expect(openExternal(resolveUrl)).rejects.toThrow("blocked");
		expect(resolveUrl).not.toHaveBeenCalled();
	});

	it("uses the desktop shell for deferred external URLs without a browser tab", async () => {
		const nativeOpen = vi.fn();
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { zuse: { app: { openExternal: nativeOpen } } },
		});
		await openExternal(async () => "https://billing.example/portal");
		expect(nativeOpen).toHaveBeenCalledWith("https://billing.example/portal");
	});

	it("uses authenticated HTTP attachments and disables native surfaces in browsers", () => {
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: {},
		});
		expect(rendererPlatformCapabilities()).toMatchObject({
			desktop: false,
			integratedBrowser: false,
			updater: false,
		});
		expect(attachmentUrl("image one")).toBe("/assets/attachments/image%20one");
	});

	it("retains privileged attachment URLs in Electron", () => {
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { zuse: { rpc: {}, browser: {}, updates: {} } },
		});
		expect(rendererPlatformCapabilities()).toMatchObject({
			desktop: true,
			integratedBrowser: true,
			updater: true,
		});
		expect(attachmentUrl("image-one")).toBe("zuse://attachments/image-one");
	});

	it("copies arbitrary text through Electron's native clipboard bridge", async () => {
		const copied: string[] = [];
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: {
				zuse: {
					app: {
						copyText: async (text: string) => {
							copied.push(text);
						},
					},
				},
			},
		});

		await copyText("claude setup-token");

		expect(copied).toEqual(["claude setup-token"]);
	});

	it("uses the browser clipboard when no desktop bridge exists", async () => {
		const copied: string[] = [];
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: {},
		});
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: {
				clipboard: {
					writeText: async (text: string) => {
						copied.push(text);
					},
				},
			},
		});

		await copyText("ABCD-EFGH");

		expect(copied).toEqual(["ABCD-EFGH"]);
	});
});
