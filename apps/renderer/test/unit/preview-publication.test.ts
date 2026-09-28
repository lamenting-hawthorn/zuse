import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewPublication } from "../../src/lib/preview-publication.ts";

const setup = (initial: number[] = []) => {
	const ports = new Set(initial);
	const publish = vi.fn(async (port: number) => `https://p${port}.boxd.sh`);
	const revoke = vi.fn(async (_port?: number) => {});
	const pending = vi.fn();
	const controller = createPreviewPublication({
		publish,
		revoke,
		pending,
		ports: () => [...ports],
		remember: (port) => {
			ports.add(port);
		},
		forget: (port) => {
			ports.delete(port);
		},
	});
	return { ports, publish, revoke, pending, controller };
};
afterEach(() => vi.useRealTimers());
describe("preview publication lifecycle", () => {
	it("journals before publication and revokes after the last consumer leaves", async () => {
		const h = setup();
		const release = h.controller.retain();
		h.publish.mockImplementation(async () => {
			expect(h.ports.has(3001)).toBe(true);
			return "https://preview.boxd.sh";
		});
		await h.controller.publish(3001, () => true);
		release();
		await vi.waitFor(() => expect(h.revoke).toHaveBeenCalledWith(3001));
		expect(h.ports.size).toBe(0);
	});
	it("revokes a route created by an in-flight request after disabling", async () => {
		const h = setup();
		let complete!: (url: string) => void;
		let enabled = true;
		h.publish.mockImplementation(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const publication = h.controller.publish(3001, () => enabled);
		const rejected = expect(publication).rejects.toThrow("disabled");
		await vi.waitFor(() => expect(h.publish).toHaveBeenCalled());
		enabled = false;
		const removal = h.controller.revoke();
		complete("https://late.boxd.sh");
		await rejected;
		await removal;
		expect(h.revoke).toHaveBeenCalledWith(3001);
		expect(h.ports.size).toBe(0);
	});
	it("keeps ambiguous creation failures in the cleanup journal", async () => {
		const h = setup();
		h.publish.mockRejectedValue(new Error("response lost"));
		await expect(h.controller.publish(3001, () => true)).rejects.toThrow();
		await h.controller.revoke();
		expect(h.revoke).toHaveBeenCalledWith(3001);
	});
	it("keeps failed revocation visible and retries from a persisted journal", async () => {
		vi.useFakeTimers();
		const h = setup([3001, 3002]);
		h.revoke
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("provider unavailable"));
		await expect(h.controller.revoke()).rejects.toThrow(
			"revocation is still pending",
		);
		expect([...h.ports]).toEqual([3001]);
		expect(h.pending).toHaveBeenLastCalledWith(true);
		await vi.advanceTimersByTimeAsync(5000);
		expect(h.ports.size).toBe(0);
		expect(h.pending).toHaveBeenLastCalledWith(false);
	});
	it("does not revoke while another consumer or immediate remount retains publication", async () => {
		const h = setup([3001]);
		const release = h.controller.retain();
		release();
		const releaseNext = h.controller.retain();
		await Promise.resolve();
		await Promise.resolve();
		expect(h.revoke).not.toHaveBeenCalled();
		releaseNext();
		await vi.waitFor(() => expect(h.revoke).toHaveBeenCalledWith(3001));
	});
});
