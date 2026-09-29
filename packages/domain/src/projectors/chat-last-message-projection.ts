import type { SqlClient } from "effect/unstable/sql";

export type ChatLastMessageTarget =
	| { readonly _tag: "Chat"; readonly chatId: string }
	| { readonly _tag: "Session"; readonly sessionId: string };

/**
 * Single write owner for the denormalized chat message timestamp.
 *
 * Normal message projection targets a session; lifecycle import reconciliation
 * targets the chat snapshot directly. Keeping both routes here prevents the two
 * projectors from growing independent timestamp/write semantics.
 */
export const updateChatLastMessage = (
	sql: SqlClient.SqlClient,
	target: ChatLastMessageTarget,
	messageAt: number | null,
) => {
	const value = messageAt === null ? null : new Date(messageAt).toISOString();
	return target._tag === "Chat"
		? sql`
				UPDATE chats SET last_message_at = ${value},
					last_user_message_at = (
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
				WHERE id = ${target.chatId}
			`
		: sql`
				UPDATE chats SET last_message_at = ${value}
				WHERE id = (
					SELECT chat_id FROM sessions WHERE id = ${target.sessionId}
				)
			`;
};

/** User submissions advance recency, including messages waiting in the queue. */
export const updateChatLastUserMessage = (
	sql: SqlClient.SqlClient,
	sessionId: string,
	messageAt: number,
) => {
	const value = new Date(messageAt).toISOString();
	return sql`
		UPDATE chats SET last_user_message_at = ${value}
		WHERE id = (SELECT chat_id FROM sessions WHERE id = ${sessionId})
			AND (last_user_message_at IS NULL OR last_user_message_at < ${value})
	`;
};
