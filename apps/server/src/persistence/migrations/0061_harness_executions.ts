import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

/** Authoritative execution records; deliberately separate from disposable caches. */
export const Migration0061HarnessExecutions = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`CREATE TABLE harness_executions (
  root_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
 )`;
});
