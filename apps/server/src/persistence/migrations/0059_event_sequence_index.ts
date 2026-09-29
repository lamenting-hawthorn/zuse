import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

/** Global event cursors do not constrain stream_id. Keep idle tail reads
 * proportional to new events rather than scanning every stream of that kind. */
export const Migration0059EventSequenceIndex = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
		CREATE INDEX idx_events_kind_sequence ON events(stream_kind, sequence)
	`;
});
