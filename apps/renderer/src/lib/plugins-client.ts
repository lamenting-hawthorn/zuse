import type { PluginRequest } from "@zuse/contracts";
import { Effect } from "effect";
import { getControlPlaneRpcClient } from "./rpc-client.ts";
export async function pluginRequest(input: PluginRequest) {
	// Plugin tenancy is selected in the request, independently of the active workspace.
	const client = await getControlPlaneRpcClient({ kind: "personal" });
	return Effect.runPromise(client["plugins.request"](input));
}
