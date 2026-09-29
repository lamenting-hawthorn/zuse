import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVisibleInterval } from "../../src/lib/visible-interval.ts";

describe("visible display intervals", () => {
	let documentTarget: EventTarget & { visibilityState: string };
	beforeEach(() => {
		vi.useFakeTimers();
		documentTarget = Object.assign(new EventTarget(), {
			visibilityState: "visible",
		});
		vi.stubGlobal("document", documentTarget);
		vi.stubGlobal("window", globalThis);
	});
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});
	it("stops waking while hidden, refreshes on return, and cleans up", () => {
		const update = vi.fn();
		const stop = startVisibleInterval(update, 1_000);
		vi.advanceTimersByTime(1_000);
		expect(update).toHaveBeenCalledTimes(2);
		documentTarget.visibilityState = "hidden";
		documentTarget.dispatchEvent(new Event("visibilitychange"));
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(60_000);
		expect(update).toHaveBeenCalledTimes(2);
		documentTarget.visibilityState = "visible";
		documentTarget.dispatchEvent(new Event("visibilitychange"));
		expect(update).toHaveBeenCalledTimes(3);
		vi.advanceTimersByTime(1_000);
		expect(update).toHaveBeenCalledTimes(4);
		stop();
		documentTarget.dispatchEvent(new Event("visibilitychange"));
		expect(vi.getTimerCount()).toBe(0);
		expect(update).toHaveBeenCalledTimes(4);
	});
	it("does not start a timer when mounted hidden", () => {
		documentTarget.visibilityState = "hidden";
		const update = vi.fn();
		const stop = startVisibleInterval(update, 1_000);
		expect(update).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
		stop();
	});
});
