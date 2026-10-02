import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

/** OAuth records are encrypted before entering the database or its WAL. */
export const Migration0062ModelConnections = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`CREATE TABLE model_connection_secrets (
  namespace TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  envelope TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(namespace, connection_id)
 )`;
});
