import { createRequire } from "node:module";
import type * as NodeSqlite from "node:sqlite";
import type { ChatId, SessionId } from "@zuse/contracts";
import {
	type MessageRow,
	type SessionRow,
	sessionFromRow,
} from "./conversation-records.ts";

const require = createRequire(import.meta.url);

/** Read only the stopped, retained child copy; never attach it as the live store. */
export const readForkSnapshot = (
	databasePath: string,
	chatId: ChatId,
	sessionId: SessionId,
) => {
	const { DatabaseSync } = require("node:sqlite") as typeof NodeSqlite;
	const db = new DatabaseSync(databasePath, { readOnly: true });
	try {
		const row = db
			.prepare("SELECT * FROM sessions WHERE id = ? AND chat_id = ?")
			.get(sessionId, chatId);
		if (row === undefined)
			throw new Error("Machine fork source session is missing");
		const source = sessionFromRow(row as unknown as SessionRow);
		const rows = db
			.prepare(
				"SELECT id, session_id, role, kind, content_json, parent_item_id, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC, sequence ASC",
			)
			.all(sessionId) as unknown as MessageRow[];
		return { source, rows };
	} finally {
		db.close();
	}
};
