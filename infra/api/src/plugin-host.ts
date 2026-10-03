import type {
	PluginRequest,
	PluginResponse,
	PluginToolRequest,
} from "@zuse/contracts";
import { Context, Data } from "effect";

export interface PluginIdentity {
	readonly tenant: string;
	readonly subject: string;
}

/** Stable `{ error }` codes a plugin operation may surface over HTTP. */
export const PLUGIN_ERROR_CODES = [
	"plugin_operation_failed",
	/** OAuth server has no dynamic client registration; needs a pre-registered client. */
	"plugin_client_registration_unsupported",
	/** Neither public nor OAuth: no OAuth metadata, or an unexpected probe status. */
	"plugin_auth_unsupported",
	/** The MCP server did not answer, timed out, or is temporarily failing. */
	"plugin_unreachable",
] as const;
export type PluginErrorCode = (typeof PLUGIN_ERROR_CODES)[number];
export const isPluginErrorCode = (value: unknown): value is PluginErrorCode =>
	PLUGIN_ERROR_CODES.some((code) => code === value);

export class PluginOperationError extends Data.TaggedError(
	"PluginOperationError",
)<{ readonly code: PluginErrorCode }> {}

export class PluginHost extends Context.Service<
	PluginHost,
	{
		readonly request: (
			identity: PluginIdentity,
			request: PluginRequest,
		) => Promise<PluginResponse>;
		readonly tools: (
			identity: PluginIdentity,
			request: PluginToolRequest,
		) => Promise<unknown>;
		readonly callback: (request: Request) => Promise<Response>;
	}
>()("@zuse/api/PluginHost") {}
