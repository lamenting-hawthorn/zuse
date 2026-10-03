import { Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { CloudWorkspaceOpError } from "./cloud-workspaces.ts";

/** A tenant is a personal account or an organization, never a runtime. */
export const PluginTenant = Schema.Struct({
	id: Schema.String,
	kind: Schema.Literals(["personal", "organization"]),
	name: Schema.String,
});
export type PluginTenant = typeof PluginTenant.Type;

export const PluginDefinition = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	description: Schema.String,
	auth: Schema.Literals(["oauth", "none"]),
});
export type PluginDefinition = typeof PluginDefinition.Type;

export const PluginConnection = Schema.Struct({
	id: Schema.String,
	pluginId: Schema.String,
	label: Schema.String,
	owner: Schema.Literals(["user", "organization"]),
	state: Schema.Literals(["connecting", "connected", "needs-auth", "error"]),
	createdAt: Schema.Number,
});
export type PluginConnection = typeof PluginConnection.Type;

export const PluginSnapshot = Schema.Struct({
	kind: Schema.Literal("snapshot"),
	tenants: Schema.Array(PluginTenant),
	tenantId: Schema.String,
	endpoint: Schema.String,
	catalog: Schema.Array(PluginDefinition),
	connections: Schema.Array(PluginConnection),
});
export type PluginSnapshot = typeof PluginSnapshot.Type;

export const PluginAttempt = Schema.Struct({
	kind: Schema.Literal("attempt"),
	id: Schema.String,
	connectionId: Schema.String,
	state: Schema.Literals(["pending", "connected", "failed", "cancelled"]),
	authorizationUrl: Schema.NullOr(Schema.String),
	expiresAt: Schema.Number,
});
export type PluginAttempt = typeof PluginAttempt.Type;

export const PluginRequest = Schema.Union([
	Schema.Struct({
		action: Schema.Literal("list"),
		tenantId: Schema.optional(Schema.String),
	}),
	Schema.Struct({
		action: Schema.Literal("connect"),
		tenantId: Schema.String,
		pluginId: Schema.String,
		label: Schema.String,
		requestId: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("poll"),
		tenantId: Schema.String,
		attemptId: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("cancel"),
		tenantId: Schema.String,
		attemptId: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("complete"),
		tenantId: Schema.String,
		ticket: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("disconnect"),
		tenantId: Schema.String,
		connectionId: Schema.String,
	}),
]);
export type PluginRequest = typeof PluginRequest.Type;
export const PluginResponse = Schema.Union([
	PluginSnapshot,
	PluginAttempt,
	Schema.Struct({ kind: Schema.Literal("ok") }),
]);
export type PluginResponse = typeof PluginResponse.Type;

export const PluginsRequestRpc = Rpc.make("plugins.request", {
	payload: PluginRequest,
	success: PluginResponse,
	error: CloudWorkspaceOpError,
});

export const PluginToolRequest = Schema.Union([
	Schema.Struct({ action: Schema.Literal("search"), query: Schema.String }),
	Schema.Struct({ action: Schema.Literal("schema"), address: Schema.String }),
	Schema.Struct({
		action: Schema.Literal("call"),
		address: Schema.String,
		arguments: Schema.Record(Schema.String, Schema.Unknown),
	}),
]);
export type PluginToolRequest = typeof PluginToolRequest.Type;

export const PLUGIN_MCP_TOOLS = [
	{
		name: "plugins_search",
		description:
			"Find tools in the user's connected plugins. Search before requesting a tool schema.",
		inputSchema: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
			additionalProperties: false,
		},
	},
	{
		name: "plugins_schema",
		description:
			"Get the input schema for a connected plugin tool by its exact address.",
		inputSchema: {
			type: "object",
			properties: { address: { type: "string" } },
			required: ["address"],
			additionalProperties: false,
		},
	},
	{
		name: "plugins_call",
		description:
			"Call a connected plugin tool using its schema. May read or modify external data; subject to session permission policy.",
		inputSchema: {
			type: "object",
			properties: {
				address: { type: "string" },
				arguments: { type: "object" },
			},
			required: ["address", "arguments"],
			additionalProperties: false,
		},
	},
];
