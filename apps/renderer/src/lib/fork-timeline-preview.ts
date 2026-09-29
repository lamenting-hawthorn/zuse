import {
	Message,
	type MessageId,
	type SessionId,
	SessionTimelineProjection,
} from "@zuse/contracts";
import {
	forkMessageId,
	shouldIncludeInTranscript,
} from "@zuse/domain/conversation/transcript";
import { emptyTimelineProjection } from "@zuse/domain/projectors/timeline-reducer";

/** Readable history only: never inherit live turns, queues, or interactions. */
export const forkTimelinePreview = (
	source: SessionTimelineProjection,
	point: MessageId,
	target: SessionId,
): SessionTimelineProjection | null => {
	const index = source.messages.findIndex((message) => message.id === point);
	if (index < 0) return null;
	return SessionTimelineProjection.make({
		...emptyTimelineProjection(),
		permissionMode: source.permissionMode,
		runtimeMode: source.runtimeMode,
		messages: source.messages
			.slice(0, index + 1)
			.filter((message) => shouldIncludeInTranscript(message.content))
			.map((message) =>
				Message.make({
					...message,
					id: forkMessageId(target, message.id),
					sessionId: target,
				}),
			),
	});
};
