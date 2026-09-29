import { layer as sqliteLayer } from "@zuse/sqlite";
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { expect, it } from "vitest";
import { Migration0060ChatUserMessageTime } from "../../src/persistence/migrations/0060_chat_user_message_time.ts";

it("backfills user recency across threads without using assistant activity", async () => {
	const rows = await Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient;
			yield* sql`CREATE TABLE chats (id TEXT PRIMARY KEY)`;
			yield* sql`CREATE TABLE sessions (id TEXT PRIMARY KEY, chat_id TEXT)`;
			yield* sql`CREATE TABLE queued_messages (session_id TEXT, created_at TEXT)`;
			yield* sql`CREATE TABLE messages (session_id TEXT, role TEXT, created_at TEXT)`;
			yield* sql`INSERT INTO chats VALUES ('chat'), ('empty'), ('queued')`;
			yield* sql`INSERT INTO sessions VALUES ('one', 'chat'), ('two', 'chat'), ('three', 'queued')`;
			yield* sql`INSERT INTO messages VALUES ('one', 'user', '2026-09-01'), ('two', 'user', '2026-09-02'), ('two', 'assistant', '2026-09-03')`;
			yield* sql`INSERT INTO queued_messages VALUES ('three', '2026-09-04')`;
			yield* Migration0060ChatUserMessageTime;
			return yield* sql`SELECT * FROM chats ORDER BY id`;
		}).pipe(Effect.provide(sqliteLayer({ filename: ":memory:" }))),
	);
	expect(rows).toEqual([
		{ id: "chat", last_user_message_at: "2026-09-02" },
		{ id: "empty", last_user_message_at: null },
		{ id: "queued", last_user_message_at: "2026-09-04" },
	]);
});
