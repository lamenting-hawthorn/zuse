import { layer as sqliteLayer } from "@zuse/sqlite";
import { Effect, ManagedRuntime } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { describe, expect, it } from "vitest";
import { Migration0059EventSequenceIndex } from "../../src/persistence/migrations/0059_event_sequence_index.ts";

describe("event sequence index migration", () => {
	it("preserves existing events and seeks directly to the global cursor", async () => {
		const runtime = ManagedRuntime.make(sqliteLayer({ filename: ":memory:" }));
		try {
			await runtime.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient;
					yield* sql`CREATE TABLE events (
					sequence INTEGER PRIMARY KEY AUTOINCREMENT,
					event_id TEXT NOT NULL UNIQUE,
					stream_kind TEXT NOT NULL,
					stream_id TEXT NOT NULL,
					stream_version INTEGER NOT NULL,
					correlation_id TEXT,
					causation_event_id TEXT,
					payload_json TEXT NOT NULL,
					UNIQUE(stream_kind, stream_id, stream_version)
				)`;
					yield* sql`CREATE INDEX idx_events_stream ON events(stream_kind, stream_id, sequence)`;
					yield* sql`WITH RECURSIVE numbers(n) AS (
					VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < 10000
				) INSERT INTO events (event_id, stream_kind, stream_id, stream_version, payload_json)
				SELECT 'event-' || n, CASE WHEN n % 2 = 0 THEN 'session' ELSE 'chat' END,
					'stream-' || (n % 100), n, '{"preserved":true}' FROM numbers`;
				}),
			);
			await runtime.runPromise(Migration0059EventSequenceIndex);
			const result = await runtime.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient;
					const plan = yield* sql<{
						readonly detail: string;
					}>`EXPLAIN QUERY PLAN
					SELECT sequence, event_id, correlation_id, causation_event_id,
						stream_id, stream_version, payload_json FROM events
					WHERE stream_kind = ${"session"} AND sequence > ${9995}
					ORDER BY sequence ASC`;
					const tail = yield* sql<{
						readonly sequence: number;
						readonly payload_json: string;
					}>`
					SELECT sequence, payload_json FROM events
					WHERE stream_kind = ${"session"} AND sequence > ${9995}
					ORDER BY sequence ASC`;
					const count = yield* sql<{
						readonly count: number;
					}>`SELECT COUNT(*) AS count FROM events`;
					const emptyTail =
						yield* sql`SELECT * FROM events WHERE stream_kind = 'session' AND sequence > 10000 ORDER BY sequence ASC`;
					return { plan, tail, count, emptyTail };
				}),
			);
			const plan = result.plan.map((row) => row.detail).join("\n");
			expect(plan).toContain("idx_events_kind_sequence");
			expect(plan).toContain("stream_kind=? AND sequence>?");
			expect(plan).not.toContain("TEMP B-TREE");
			expect(result.count[0]?.count).toBe(10000);
			expect(result.tail).toEqual(
				[9996, 9998, 10000].map((sequence) => ({
					sequence,
					payload_json: '{"preserved":true}',
				})),
			);
			expect(result.emptyTail).toEqual([]);
		} finally {
			await runtime.dispose();
		}
	});
});
