import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, it } from "vitest";
import {
	acquireProcessLock,
	withProcessLock,
} from "../../src/process/process-lock.ts";

it("distinguishes contention timeout from acquisition failure and retains the cause", async () => {
	const directory = await mkdtemp(join(tmpdir(), "zuse-lock-test-"));
	const path = join(directory, "lock.sqlite");
	const lock = await Effect.runPromise(acquireProcessLock(path));
	try {
		await expect(
			Effect.runPromise(acquireProcessLock(path, 1)),
		).rejects.toMatchObject({ kind: "timeout" });
		await expect(
			Effect.runPromise(
				acquireProcessLock(join(directory, "missing", "lock.sqlite"), 1),
			),
		).rejects.toMatchObject({ kind: "unavailable", cause: expect.any(Error) });
	} finally {
		lock.close();
		await rm(directory, { recursive: true, force: true });
	}
});
it("releases the shared lock when its operation fails", async () => {
	const directory = await mkdtemp(join(tmpdir(), "zuse-lock-release-"));
	const path = join(directory, "nested", "lock.sqlite");
	try {
		await expect(
			withProcessLock(path, async () => {
				throw new Error("operation failed");
			}),
		).rejects.toThrow("operation failed");
		const lock = await Effect.runPromise(acquireProcessLock(path, 1));
		lock.close();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
