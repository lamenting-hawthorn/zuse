import { describe, expect, it } from "vitest";
import { resetsInLabel } from "../../src/components/usage/usage-meter.tsx";
import {
	creditUsage,
	formatCredits,
	percentLeft,
	usageLimitsUnavailableLabel,
} from "../../src/lib/usage-limits-display.ts";
import { usagePace } from "../../src/lib/usage-pace.ts";

describe("usage limit display helpers", () => {
	it("formats reset countdowns with two useful units", () => {
		expect(
			resetsInLabel("2026-01-03T20:00:00Z", Date.parse("2026-01-02T00:00:00Z")),
		).toBe("1d 20h");
		expect(
			resetsInLabel("2026-01-02T04:05:00Z", Date.parse("2026-01-02T00:00:00Z")),
		).toBe("4h 05m");
	});

	it("reports reserve against elapsed window pace", () => {
		const end = Date.parse("2026-01-08T00:00:00Z");
		expect(
			usagePace(
				30,
				new Date(end).toISOString(),
				10_080,
				end - 3.5 * 24 * 60 * 60 * 1_000,
			)?.label,
		).toBe("+20% in reserve");
	});

	it("uses provider-specific sign-in copy for usage limit popups", () => {
		expect(usageLimitsUnavailableLabel("claude", "no-credentials")).toBe(
			"Sign in to Claude Code to see limits",
		);
		expect(usageLimitsUnavailableLabel("kiro", "no-credentials")).toBe(
			"Sign in with kiro-cli login to see limits",
		);
	});

	it("uses provider-specific expired-session copy for usage limit popups", () => {
		expect(usageLimitsUnavailableLabel("claude", "expired")).toBe(
			"Claude Code session expired: sign in again",
		);
		expect(usageLimitsUnavailableLabel("kiro", "expired")).toBe(
			"Session expired: run kiro-cli login",
		);
	});

	it("covers non-auth unavailable states for usage limit popups", () => {
		expect(usageLimitsUnavailableLabel("codex", "unsupported")).toBe(
			"Not available for this account",
		);
		expect(usageLimitsUnavailableLabel("grok", "scope-missing")).toBe(
			"Usage limits unavailable for this scope",
		);
		expect(usageLimitsUnavailableLabel("gemini", "error")).toBe(
			"Could not load limits: try again",
		);
		expect(usageLimitsUnavailableLabel("claude", undefined)).toBe(
			"No usage data available",
		);
	});
});

describe("quota values", () => {
	it.each([
		[0, 100],
		[100, 0],
		[-10, 100],
		[120, 0],
		[NaN, null],
		[Infinity, null],
		[null, null],
		[undefined, null],
	])("bounds remaining percentage for %s", (used, remaining) => {
		expect(percentLeft(used)).toBe(remaining);
	});
	it("does not invent totals for exhausted or unknown credit windows", () => {
		expect(creditUsage(0, 100)).toBeNull();
		expect(creditUsage(50, null)).toBeNull();
		expect(creditUsage(50, 50)).toEqual({
			used: 50,
			remaining: 50,
			limit: 100,
		});
		expect(formatCredits(0)).toBe("0");
		expect(formatCredits(1500)).toBe("1.5k");
		expect(formatCredits(Infinity)).toBe("—");
	});
	it("handles missing and invalid resets", () => {
		expect(resetsInLabel(null)).toBeNull();
		expect(resetsInLabel("invalid")).toBeNull();
	});
});
