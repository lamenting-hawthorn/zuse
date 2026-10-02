import { chmodSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";

export class ProcessLockError extends Error {
	constructor(
		readonly kind: "timeout" | "unavailable",
		cause?: unknown,
	) {
		super(
			kind === "timeout"
				? "Timed out waiting for process lock"
				: "Failed to acquire process lock",
			{ cause },
		);
	}
}

/** OS-backed mutex released on process death. Never unlink or replace its inode. */
export const acquireProcessLock = (
	path: string,
	attempts = 140,
): Effect.Effect<DatabaseSync, Error> =>
	Effect.gen(function* () {
		for (let attempt = 0; attempt < attempts; attempt++) {
			const result = yield* Effect.try({
				try: () => {
					const database = new DatabaseSync(path);
					try {
						chmodSync(path, 0o600);
						database.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
						return database;
					} catch (error) {
						database.close();
						throw error;
					}
				},
				catch: (error) => error,
			}).pipe(Effect.result);
			if (result._tag === "Success") return result.success;
			const error = result.failure;
			if (
				!(
					typeof error === "object" &&
					error !== null &&
					"errcode" in error &&
					typeof error.errcode === "number" &&
					(error.errcode & 255) === 5
				)
			)
				return yield* Effect.fail(new ProcessLockError("unavailable", error));
			yield* Effect.sleep("150 millis");
		}
		return yield* Effect.fail(new ProcessLockError("timeout"));
	});

/** Acquire and release with one owner; credential callers can await this safely. */
export async function withProcessLock<T>(
	path: string,
	operation: () => Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const lock = await Effect.runPromise(acquireProcessLock(path), { signal });
	try {
		signal?.throwIfAborted();
		return await operation();
	} finally {
		lock.close();
	}
}
