import type {
	PluginRequest,
	PluginResponse,
	PluginToolRequest,
} from "@zuse/contracts";
import { Context } from "effect";

export interface PluginIdentity {
	readonly tenant: string;
	readonly subject: string;
}
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
