import {
	type MessageContent,
	MessageId,
	type SessionId,
} from "@zuse/contracts";

const transcriptSkipKinds: ReadonlySet<string> = new Set([
	"usage",
	"context_usage",
	"context_compaction",
	"usage_limit",
	"subagent_progress",
]);

export const shouldIncludeInTranscript = (content: MessageContent): boolean =>
	!transcriptSkipKinds.has(content._tag);

export const forkMessageId = (
	sessionId: SessionId,
	sourceId: MessageId,
): MessageId => MessageId.make(`fork:${sessionId}:${sourceId}`);
