import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type { PluginResponse } from "@zuse/contracts";
import {
	isPluginErrorCode,
	type PluginHost,
	type PluginIdentity,
	PluginOperationError,
} from "./plugin-host.ts";

export const makeCloudflarePluginHost = (
	vaults: DurableObjectNamespace,
): typeof PluginHost.Service => {
	const dispatch = async (identity: PluginIdentity, payload: object) => {
		const stub = vaults.get(vaults.idFromName(identity.tenant));
		const response = await stub.fetch("https://plugins.internal/request", {
			method: "POST",
			body: JSON.stringify({ identity, ...payload }),
		});
		if (!response.ok) {
			const body = (await response.json().catch(() => null)) as {
				error?: unknown;
			} | null;
			throw new PluginOperationError({
				code: isPluginErrorCode(body?.error)
					? body.error
					: "plugin_operation_failed",
			});
		}
		return response.json();
	};
	return {
		request: (identity, command) =>
			dispatch(identity, { command }) as Promise<PluginResponse>,
		tools: (identity, tool) => dispatch(identity, { tool }),
		callback: async (request) => {
			const url = new URL(request.url);
			const id = url.pathname.split("/").at(-1) ?? "";
			const stub = vaults.get(vaults.idFromString(id));
			return (await stub.fetch(
				`https://plugins.internal/callback${url.search}`,
				{ redirect: "manual" },
			)) as unknown as Response;
		},
	};
};
