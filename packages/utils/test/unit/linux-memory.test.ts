import { describe, expect, test } from "vitest";
import { hasNewOomKill, linuxMemory } from "../../src/linux-memory.ts";

describe("Linux memory evidence", () => {
	test("does not count reclaimable cache as pressure", () => {
		expect(
			linuxMemory(
				"MemTotal: 4096000 kB\nMemFree: 100 kB\nMemAvailable: 2000000 kB",
			),
		).toMatchObject({ pressure: false, used: 2096000 * 1024 });
	});
	test("detects low headroom and rejects incomplete or invalid readings", () => {
		expect(
			linuxMemory("MemTotal: 4096000 kB\nMemAvailable: 100000 kB")?.pressure,
		).toBe(true);
		for (const raw of [
			"",
			"MemTotal: 0 kB\nMemAvailable: 0 kB",
			"MemTotal: 100 kB\nMemAvailable: 200 kB",
			"MemTotal: 10 kB",
		])
			expect(linuxMemory(raw)).toBeNull();
	});
	test("requires a new OOM kill in the same boot and runtime generation", () => {
		const baseline = JSON.stringify({
			bootId: "boot",
			generation: "3",
			oomKills: 2,
		});
		expect(hasNewOomKill(baseline, "boot\n", "oom_kill 3\n", 3)).toBe(true);
		expect(hasNewOomKill(baseline, "different", "oom_kill 3", 3)).toBe(false);
		expect(hasNewOomKill(baseline, "boot", "oom_kill 3", 4)).toBe(false);
		expect(hasNewOomKill(baseline, "boot", "oom_kill 2", 3)).toBe(false);
		expect(hasNewOomKill(baseline, "boot", "oom_kill 0", 3)).toBe(false);
		expect(hasNewOomKill("broken", "boot", "oom_kill 3", 3)).toBe(false);
		expect(hasNewOomKill(baseline, "boot", "", 3)).toBe(false);
	});
});
