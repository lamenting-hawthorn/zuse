import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";

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
				return yield* Effect.fail(new Error("Failed to acquire process lock"));
			yield* Effect.sleep("150 millis");
		}
		return yield* Effect.fail(new Error("Timed out waiting for process lock"));
	});
