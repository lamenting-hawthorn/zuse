import type { PluginDefinition, PluginSnapshot } from "@zuse/contracts";
import { useEffect, useState } from "react";
import { onPluginsChanged, pluginRequest } from "./plugins-client.ts";

/** Plugins the signed-in account can use right now, for `@` mentions. */
export type ConnectedPlugin = Pick<PluginDefinition, "id" | "name" | "domain">;

const FRESH_MS = 30_000;
let cached: { at: number; plugins: readonly ConnectedPlugin[] } | null = null;
let inflight: Promise<readonly ConnectedPlugin[]> | null = null;

const connectedOf = (snapshot: PluginSnapshot): readonly ConnectedPlugin[] => {
	const ids = new Set(
		snapshot.connections
			.filter((connection) => connection.state === "connected")
			.map((connection) => connection.pluginId),
	);
	return snapshot.catalog
		.filter((plugin) => ids.has(plugin.id))
		.map(({ id, name, domain }) => ({ id, name, domain }));
};

/**
 * The Plugins page shares its fresh snapshot so mentions never lag it. Agent
 * sessions use personal connections only, so other tenants are ignored.
 */
export const rememberPluginSnapshot = (snapshot: PluginSnapshot) => {
	if (!snapshot.tenantId.startsWith("personal:")) return;
	cached = { at: Date.now(), plugins: connectedOf(snapshot) };
};

onPluginsChanged(() => {
	cached = null;
});

/**
 * Connected plugins, cached briefly: the catalog snapshot is large and the
 * `@` menu opens often. Failures (signed out, offline) mean "none".
 */
export function loadConnectedPlugins(): Promise<readonly ConnectedPlugin[]> {
	if (cached !== null && Date.now() - cached.at < FRESH_MS)
		return Promise.resolve(cached.plugins);
	inflight ??= pluginRequest({ action: "list" })
		.then((result) => {
			if (result.kind !== "snapshot") return [];
			rememberPluginSnapshot(result);
			return connectedOf(result);
		})
		.catch(() => [])
		.finally(() => {
			inflight = null;
		});
	return inflight;
}

/** Context the agent receives for an `@plugin` mention. */
export const pluginMentionContext = (plugin: {
	readonly id: string;
	readonly name: string;
}) => ({
	_tag: "context" as const,
	id: `plugin:${plugin.id}`,
	label: plugin.name,
	comment: `Use my connected ${plugin.name} plugin for this request. Find its tools with plugins_search (an empty query lists every connected tool; ${plugin.name} tool addresses start with "tools.${plugin.id}."), read a tool's input with plugins_schema, then run it with plugins_call.`,
});

/** Logos come from the same public registry as the catalog. */
export const pluginIconUrl = (domain: string) =>
	`https://integrations.sh/logo/${encodeURIComponent(domain)}`;

/** Plugin id from a managed tool address (`tools.<plugin>.user.<id>.<tool>`). */
export const pluginToolAddress = (
	address: string,
): { readonly pluginId: string; readonly tool: string } | null => {
	const match = /^tools\.([^.]+)\.user\.[^.]+\.(.+)$/.exec(address);
	return match === null
		? null
		: { pluginId: match[1] ?? "", tool: match[2] ?? "" };
};

/** Display info for a connected plugin; null until known or if disconnected. */
export function useConnectedPlugin(
	pluginId: string | null,
): ConnectedPlugin | null {
	const [plugin, setPlugin] = useState<ConnectedPlugin | null>(
		() => cached?.plugins.find((item) => item.id === pluginId) ?? null,
	);
	useEffect(() => {
		if (pluginId === null) return;
		let cancelled = false;
		void loadConnectedPlugins().then((plugins) => {
			if (!cancelled)
				setPlugin(plugins.find((item) => item.id === pluginId) ?? null);
		});
		return () => {
			cancelled = true;
		};
	}, [pluginId]);
	return plugin;
}
