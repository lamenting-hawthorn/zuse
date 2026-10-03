import {
	PLUGIN_CALLBACK_PORTS,
	type PluginRequest,
	type PluginReturnTo,
} from "@zuse/contracts";
import { Effect } from "effect";
import { getControlPlaneRpcClient } from "./rpc-client.ts";

export async function pluginRequest(input: PluginRequest) {
	// Plugin tenancy is selected in the request, independently of the active workspace.
	const client = await getControlPlaneRpcClient({ kind: "personal" });
	return Effect.runPromise(client["plugins.request"](input));
}

/**
 * Where the provider callback should hand the ticket back. Desktop returns to
 * its sign-in loopback so the browser never has to open the web app.
 */
export async function pluginReturnTo(): Promise<PluginReturnTo> {
	const port = await window.zuse?.plugins?.callbackPort().catch(() => null);
	const allowed = PLUGIN_CALLBACK_PORTS.find((value) => value === port);
	return allowed === undefined
		? { kind: "web" }
		: { kind: "desktop", port: allowed };
}

const listeners = new Set<() => void>();

/** Connections changed outside the Plugins page (an OAuth return). */
export const notifyPluginsChanged = () => {
	for (const listener of listeners) listener();
};

export const onPluginsChanged = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
