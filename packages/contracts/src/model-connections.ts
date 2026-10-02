import { Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";

/** Public connection metadata. Credentials and ID tokens never cross this boundary. */
export const ModelConnection = Schema.Struct({
	storage: Schema.optional(Schema.Literals(["local", "account"])),
	provider: Schema.optional(Schema.Literals(["chatgpt", "supergrok"])),
	id: Schema.String,
	clientId: Schema.String,
	name: Schema.String,
	email: Schema.optional(Schema.String),
	createdAt: Schema.Number,
	preferred: Schema.Boolean,
	authorized: Schema.Boolean,
	status: Schema.Literals([
		"connected",
		"permission-required",
		"disconnected",
		"pending",
	]),
	planNoticeSeen: Schema.Boolean,
});
export type ModelConnection = typeof ModelConnection.Type;
export type ModelConnectionProvider = NonNullable<ModelConnection["provider"]>;
export type ModelConnectionStorage = NonNullable<ModelConnection["storage"]>;
export class ModelConnectionError extends Schema.TaggedErrorClass<ModelConnectionError>()(
	"ModelConnectionError",
	{
		code: Schema.Literals([
			"unavailable",
			"busy",
			"cancelled",
			"timeout",
			"unknown_registration",
			"invalid_name",
			"access_denied",
			"invalid_callback",
			"identity_mismatch",
			"verification_failed",
			"reauthorization_required",
			"temporarily_unavailable",
			"storage_failed",
		]),
	},
) {}
export const ModelConnectionStatus = Schema.Struct({
	available: Schema.Boolean,
	localAvailable: Schema.optional(Schema.Boolean),
	accountAvailable: Schema.optional(Schema.Boolean),
	accountError: Schema.optional(Schema.Boolean),
	supergrokAvailable: Schema.optional(Schema.Boolean),
	chatgptAvailable: Schema.optional(Schema.Boolean),
	connections: Schema.Array(ModelConnection),
});
export type ModelConnectionStatus = typeof ModelConnectionStatus.Type;
export const ModelSignInEvent = Schema.Union([
	Schema.Struct({
		_tag: Schema.Literal("device"),
		userCode: Schema.String,
		verificationUrl: Schema.String,
		expiresAt: Schema.Number,
	}),
	Schema.Struct({ _tag: Schema.Literal("url"), url: Schema.String }),
	Schema.Struct({
		_tag: Schema.Literal("connected"),
		connection: ModelConnection,
	}),
]);
export type ModelSignInEvent = typeof ModelSignInEvent.Type;
export const ModelConnectionsRpc = Rpc.make("modelConnections.connections", {
	payload: Schema.Struct({}),
	success: ModelConnectionStatus,
	error: ModelConnectionError,
});
export const ModelConnectRpc = Rpc.make("modelConnections.connect", {
	payload: Schema.Struct({
		connectionId: Schema.optional(Schema.String),
		provider: Schema.optional(Schema.Literals(["chatgpt", "supergrok"])),
		storage: Schema.optional(Schema.Literals(["local", "account"])),
	}),
	success: ModelSignInEvent,
	stream: true,
	error: ModelConnectionError,
});
export const ModelConnectionRenameRpc = Rpc.make("modelConnections.rename", {
	payload: Schema.Struct({ connectionId: Schema.String, name: Schema.String }),
	success: Schema.Void,
	error: ModelConnectionError,
});
export const ModelConnectionPreferredRpc = Rpc.make(
	"modelConnections.preferred",
	{
		payload: Schema.Struct({ connectionId: Schema.String }),
		success: Schema.Void,
		error: ModelConnectionError,
	},
);
export const ModelConnectionDisconnectRpc = Rpc.make(
	"modelConnections.disconnect",
	{
		payload: Schema.Struct({ connectionId: Schema.String }),
		success: Schema.Struct({ revoked: Schema.Boolean }),
		error: ModelConnectionError,
	},
);
export const ModelConnectionAcknowledgePlanRpc = Rpc.make(
	"modelConnections.acknowledgePlan",
	{
		payload: Schema.Struct({ connectionId: Schema.String }),
		success: Schema.Void,
		error: ModelConnectionError,
	},
);
