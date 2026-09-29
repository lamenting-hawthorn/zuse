import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export const Migration0060ChatUserMessageTime = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`ALTER TABLE chats ADD COLUMN last_user_message_at TEXT`;
	yield* sql`
		UPDATE chats SET last_user_message_at = (
			SELECT MAX(user_messages.created_at) FROM (
				SELECT messages.created_at FROM messages
				JOIN sessions ON sessions.id = messages.session_id
				WHERE sessions.chat_id = chats.id AND messages.role = 'user'
				UNION ALL
				SELECT queued_messages.created_at FROM queued_messages
				JOIN sessions ON sessions.id = queued_messages.session_id
				WHERE sessions.chat_id = chats.id
			) AS user_messages
		)
	`;
});
