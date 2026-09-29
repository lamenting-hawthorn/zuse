import { afterEach, describe, expect, test, vi } from "vitest";

import {
	createRendererLagSample,
	installRendererLagMonitor,
} from "../../src/lib/renderer-lag-monitor.ts";

describe("renderer lag probe lifecycle", () => {
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});
	test("cancels pending frames and all probe wakeups while hidden", () => {
		vi.useFakeTimers();
		const page = Object.assign(new EventTarget(), {
			visibilityState: "visible",
		});
		vi.stubGlobal("document", page);
		vi.stubGlobal("window", globalThis);
		vi.stubGlobal("PerformanceObserver", undefined);
		const request = vi.fn(() => 1);
		const cancel = vi.fn();
		vi.stubGlobal("requestAnimationFrame", request);
		vi.stubGlobal("cancelAnimationFrame", cancel);
		const stop = installRendererLagMonitor(vi.fn(), () => ({
			recentActions: [],
			activeWorkloads: [],
			relatedOperations: [],
		}));
		expect(request).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(5_000);
		expect(request).toHaveBeenCalledTimes(1);
		page.visibilityState = "hidden";
		page.dispatchEvent(new Event("visibilitychange"));
		expect(cancel).toHaveBeenCalledWith(1);
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(60_000);
		expect(request).toHaveBeenCalledTimes(1);
		page.visibilityState = "visible";
		page.dispatchEvent(new Event("visibilitychange"));
		expect(request).toHaveBeenCalledTimes(2);
		stop();
		expect(vi.getTimerCount()).toBe(0);
		page.dispatchEvent(new Event("visibilitychange"));
		expect(request).toHaveBeenCalledTimes(2);
	});
});

describe("renderer lag classification", () => {
	test("ignores short and background animation gaps", () => {
		expect(
			createRendererLagSample({
				kind: "animation-stall",
				durationMs: 99,
				visible: true,
				now: () => "2026-07-31T00:00:00.000Z",
				id: () => "lag-1",
			}),
		).toBeNull();
		expect(
			createRendererLagSample({
				kind: "animation-stall",
				durationMs: 600,
				visible: false,
				now: () => "2026-07-31T00:00:00.000Z",
				id: () => "lag-2",
			}),
		).toBeNull();
	});

	test("creates a sanitized renderer lag sample at the public threshold", () => {
		expect(
			createRendererLagSample({
				kind: "input-latency",
				durationMs: 250.456,
				visible: true,
				name: "click button#secret",
				now: () => "2026-07-31T00:00:00.000Z",
				id: () => "lag-3",
			}),
		).toEqual({
			id: "lag-3",
			capturedAt: "2026-07-31T00:00:00.000Z",
			kind: "input-latency",
			durationMs: 250.5,
			source: "renderer",
			name: "renderer.input-latency",
		});
	});

	test("retains safe context when detailed browser timing is unavailable", () => {
		expect(
			createRendererLagSample(
				{
					kind: "long-task",
					durationMs: 250,
					visible: true,
					now: () => "2026-07-31T00:00:00.000Z",
					id: () => "lag-4",
				},
				{
					recentActions: ["keyboard.navigate"],
					activeWorkloads: ["agent"],
					relatedOperations: ["rpc:workspace.list"],
				},
			),
		).toMatchObject({
			attribution: {
				cause: "unknown",
				confidence: "low",
				recentActions: ["keyboard.navigate"],
				activeWorkloads: ["agent"],
				relatedOperations: ["rpc:workspace.list"],
			},
		});
	});
});
