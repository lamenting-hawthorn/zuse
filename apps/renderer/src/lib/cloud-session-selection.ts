import type {
	CloudChatSummary,
	FolderId,
	Session,
	SessionId,
} from "@zuse/contracts";
import { cloudSummaryActiveSessionId } from "./cloud-workspace-catalog.ts";
import type { EnvironmentShellData } from "./environment-shell-client-bus.ts";

/** Bind a browser selection only to the selected chat's authoritative runtime checkout. */
export const cloudRuntimeProjectId = (
	summary: CloudChatSummary,
	shell: EnvironmentShellData | null,
): FolderId | null => {
	const chat = Object.values(shell?.chatsByProject ?? {})
		.flat()
		.find((candidate) => candidate.id === summary.chatId);
	return chat !== undefined &&
		shell?.folders.some((folder) => folder.id === chat.projectId)
		? chat.projectId
		: null;
};

/** Resolve only against this cloud environment, never the active local computer. */
export const resolveCloudSession = (
	summary: CloudChatSummary,
	shell: EnvironmentShellData | null,
	selectedSessionId: SessionId | null,
): Session | null => {
	const sessions = Object.values(shell?.sessionsByProject ?? {})
		.flat()
		.filter(
			(session) =>
				session.chatId === summary.chatId && session.archivedAt === null,
		);
	const chat = Object.values(shell?.chatsByProject ?? {})
		.flat()
		.find((candidate) => candidate.id === summary.chatId);
	if (chat?.archivedAt != null) return null;
	for (const id of [
		selectedSessionId,
		chat?.activeSessionId,
		cloudSummaryActiveSessionId(summary),
	]) {
		const session = sessions.find((candidate) => candidate.id === id);
		if (session !== undefined) return session;
	}
	return sessions[0] ?? null;
};
