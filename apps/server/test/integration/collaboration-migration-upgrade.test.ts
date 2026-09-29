import { layer as sqliteLayer } from "@zuse/sqlite";
import { Effect, Layer, ManagedRuntime } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { expect, it } from "vitest";
import { Migration0055StagingApiOrigin } from "../../src/persistence/migrations/0055_staging_api_origin.ts";
import { Migration0056DeviceBridge } from "../../src/persistence/migrations/0056_device_bridge.ts";
import { Migration0057DeviceBridgeDefaultAccess } from "../../src/persistence/migrations/0057_device_bridge_default_access.ts";
import { Migration0058CollaborationFoundation } from "../../src/persistence/migrations/0058_collaboration_foundation.ts";
import { Migration0058QuestionAnswerDeliveries } from "../../src/persistence/migrations/0058_question_answer_deliveries.ts";
import {
	MigrationsLive,
	MigrationsThrough0054Live,
} from "../../src/persistence/migrations.ts";

it.each([
	58, 59,
])("preserves collaboration data from branch migration %i across upgrade and restart", async (legacyId) => {
	const sqlite = sqliteLayer({ filename: ":memory:" });
	const runtime = ManagedRuntime.make(
		Layer.merge(sqlite, MigrationsThrough0054Live.pipe(Layer.provide(sqlite))),
	);
	try {
		await runtime.runPromise(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient;
				yield* Migration0055StagingApiOrigin;
				yield* Migration0056DeviceBridge;
				yield* Migration0057DeviceBridgeDefaultAccess;
				yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (55, 'staging_api_origin'), (56, 'device_bridge'), (57, 'device_bridge_default_access')`;
				if (legacyId === 59) {
					yield* Migration0058QuestionAnswerDeliveries;
					yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (58, 'question_answer_deliveries')`;
				}
				yield* Migration0058CollaborationFoundation;
				yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${legacyId}, 'collaboration_foundation')`;
				yield* sql`INSERT INTO collaboration_teams (id, name, created_at, updated_at) VALUES ('team', 'Preserved', '2026-09-01', '2026-09-01')`;
			}),
		);
		for (let restart = 0; restart < 2; restart++) {
			await runtime.runPromise(
				Effect.void.pipe(Effect.provide(MigrationsLive)),
			);
		}
		const state = await runtime.runPromise(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient;
				return {
					teams: yield* sql`SELECT id, name FROM collaboration_teams`,
					ledger:
						yield* sql`SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 58 ORDER BY migration_id`,
					indexes:
						yield* sql`SELECT name FROM sqlite_master WHERE name = 'idx_events_kind_sequence'`,
					columns: yield* sql<{ name: string }>`PRAGMA table_info(chats)`,
				};
			}),
		);
		expect(state.teams).toEqual([{ id: "team", name: "Preserved" }]);
		expect(state.ledger).toEqual([
			{ migration_id: 58, name: "question_answer_deliveries" },
			{ migration_id: 59, name: "event_sequence_index" },
			{ migration_id: 60, name: "chat_user_message_time" },
			{ migration_id: 61, name: "collaboration_foundation" },
		]);
		expect(state.indexes).toHaveLength(1);
		expect(
			state.columns.some((column) => column.name === "last_user_message_at"),
		).toBe(true);
	} finally {
		await runtime.dispose();
	}
});
