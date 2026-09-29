import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ingest, runPromise } = vi.hoisted(() => ({
	ingest: vi.fn(),
	runPromise: vi.fn(),
}));
vi.mock("../../src/lib/hosted-connect.ts", () => ({
	isHostedProduct: () => false,
}));
vi.mock("../../src/lib/rpc-client.ts", () => ({
	getControlPlaneRpcClient: async () => ({ "diagnostics.ingest": ingest }),
}));
vi.mock("effect", () => ({ Effect: { runPromise } }));

describe("diagnostic upload scheduling", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.stubGlobal("window", globalThis);
		ingest.mockReset();
		runPromise.mockReset().mockResolvedValue(undefined);
	});
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});
	it("backs off failures up to a minute, without new logs bypassing the delay", async () => {
		const { recordDiagnosticEvent } = await import(
			"../../src/lib/diagnostics-recorder.ts"
		);
		const log = () =>
			recordDiagnosticEvent({
				level: "warn",
				source: "test",
				message: "failure",
			});
		runPromise.mockRejectedValue(new Error("offline"));
		log();
		await vi.advanceTimersByTimeAsync(250);
		expect(ingest).toHaveBeenCalledTimes(1);
		for (const delay of [
			1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000,
		]) {
			const attempts = ingest.mock.calls.length;
			log();
			await vi.advanceTimersByTimeAsync(delay - 1);
			expect(ingest).toHaveBeenCalledTimes(attempts);
			await vi.advanceTimersByTimeAsync(1);
			expect(ingest).toHaveBeenCalledTimes(attempts + 1);
		}
		runPromise.mockResolvedValue(undefined);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(vi.getTimerCount()).toBe(0);
		const attempts = ingest.mock.calls.length;
		log();
		await vi.advanceTimersByTimeAsync(250);
		expect(ingest).toHaveBeenCalledTimes(attempts + 1);
	});
	it("retains newer logs when a slow upload's batch is evicted from the queue", async () => {
		const { recordDiagnosticEvent, flushRendererDiagnostics } = await import(
			"../../src/lib/diagnostics-recorder.ts"
		);
		let complete!: () => void;
		runPromise.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					complete = resolve;
				}),
		);
		recordDiagnosticEvent({ level: "warn", source: "test", message: "old" });
		const upload = flushRendererDiagnostics();
		await vi.advanceTimersByTimeAsync(0);
		for (let index = 0; index < 200; index += 1) {
			recordDiagnosticEvent({
				level: "warn",
				source: "test",
				message: `new-${index}`,
			});
		}
		expect(vi.getTimerCount()).toBe(0);
		complete();
		await upload;
		await vi.advanceTimersByTimeAsync(250);
		expect(ingest).toHaveBeenCalledTimes(2);
		const events = ingest.mock.calls[1]?.[0].events;
		expect(events).toHaveLength(200);
		expect(events[0].message).toBe("new-0");
		expect(events[199].message).toBe("new-199");
		expect(vi.getTimerCount()).toBe(0);
	});
});
