import type { SandboxProviderAdapter } from "@zuse/sandbox-providers";
import {
	hasNewOomKill,
	linuxMemory,
	RUNTIME_MEMORY_BASELINE_PATH,
} from "@zuse/utils/linux-memory";
import { Effect } from "effect";

/** Best effort, bounded, read-only; a dead guest must not block reconciliation. */
export const readCloudMemory = (
	provider: SandboxProviderAdapter,
	sandboxId: string,
	generation: unknown,
) => {
	const read = (path: string) =>
		provider.readTextFile(sandboxId, path, "zuse").pipe(
			Effect.timeout("2 seconds"),
			Effect.catch(() => Effect.succeed("")),
		);
	return Effect.all(
		[
			read("/proc/meminfo"),
			read("/proc/vmstat"),
			read("/proc/sys/kernel/random/boot_id"),
			read(RUNTIME_MEMORY_BASELINE_PATH),
		],
		{ concurrency: 4 },
	).pipe(
		Effect.map(([meminfo, vmstat, bootId, baseline]) => ({
			memory: linuxMemory(meminfo),
			oom: hasNewOomKill(baseline, bootId, vmstat, generation),
		})),
	);
};

export const MEMORY_RECOVERY_WINDOW_MS = 10 * 60_000;
export const MEMORY_PRESSURE_WAIT_MS = 5 * 60_000;
export const MEMORY_RECHECK_MS = 30_000;
export const MAX_MEMORY_RESTARTS = 3;
