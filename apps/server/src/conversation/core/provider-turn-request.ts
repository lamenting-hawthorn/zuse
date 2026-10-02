import {
	AgentTurnId,
	ComposerInput,
	QueuedMessageInput,
} from "@zuse/contracts";
import { Schema } from "effect";

export const ProviderStartRequest = Schema.Struct({
	initialPrompt: Schema.NullOr(Schema.String),
	initialTurnId: Schema.optional(Schema.NullOr(AgentTurnId)),
	modelOptionsJson: Schema.NullOr(Schema.String),
	enableSubagents: Schema.Boolean,
	forkFromResume: Schema.Boolean,
	background: Schema.Boolean,
	postBootStatus: Schema.Literals(["idle", "running"]),
});

export const decodeProviderStartRequest = Schema.decodeUnknownEffect(
	Schema.fromJsonString(ProviderStartRequest),
);

export const decodeProviderModelOptions = Schema.decodeUnknownEffect(
	Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

export const decodeProviderTurnInput = Schema.decodeUnknownEffect(
	Schema.fromJsonString(ComposerInput),
);

export const decodeQueuedTurnInput = Schema.decodeUnknownEffect(
	Schema.fromJsonString(QueuedMessageInput),
);
