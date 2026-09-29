import { Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";

const Text = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(2048),
);
export const ExecutorConnection = Schema.Struct({
	owner: Schema.String,
	integration: Schema.String,
	name: Schema.String,
	identityLabel: Schema.NullOr(Schema.String),
	expiresAt: Schema.NullOr(Schema.Number),
});
export const ExecutorIntegration = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	description: Schema.String,
	kind: Schema.String,
	authMethods: Schema.Array(Schema.Struct({ kind: Schema.String })),
});
export const ExecutorToolkit = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
});
export const ExecutorState = Schema.Struct({
	configured: Schema.Boolean,
	url: Schema.NullOr(Schema.String),
	enabled: Schema.Boolean,
	toolkit: Schema.NullOr(Schema.String),
	integrations: Schema.Array(ExecutorIntegration),
	connections: Schema.Array(ExecutorConnection),
	toolkits: Schema.Array(ExecutorToolkit),
	error: Schema.NullOr(Schema.String),
});
export type ExecutorState = typeof ExecutorState.Type;
export const ExecutorCommand = Schema.Union([
	Schema.TaggedStruct("connect", {
		url: Text,
		token: Schema.String.check(
			Schema.isMinLength(1),
			Schema.isMaxLength(16384),
		),
	}),
	Schema.TaggedStruct("configure", {
		enabled: Schema.Boolean,
		toolkit: Schema.NullOr(Text),
	}),
	Schema.TaggedStruct("disconnect", {}),
]);
export type ExecutorCommand = typeof ExecutorCommand.Type;
export class ExecutorError extends Schema.TaggedErrorClass<ExecutorError>()(
	"ExecutorError",
	{ reason: Schema.String },
) {}
export const ExecutorStateRpc = Rpc.make("executor.state", {
	success: ExecutorState,
	error: ExecutorError,
});
export const ExecutorExecuteRpc = Rpc.make("executor.execute", {
	payload: ExecutorCommand,
	success: ExecutorState,
	error: ExecutorError,
});
