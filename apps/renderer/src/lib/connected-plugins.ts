import type { PluginDefinition, PluginSnapshot } from "@zuse/contracts";
import { useMemo } from "react";
import { useAuth } from "../hooks/use-auth.ts";
import { usePluginSnapshot } from "./plugins-client.ts";

/** Plugins the signed-in account can use right now, for `@` mentions. */
export type ConnectedPlugin = Pick<PluginDefinition, "id" | "name" | "domain">;

const connectedOf = (
	snapshot: PluginSnapshot | null,
): readonly ConnectedPlugin[] => {
	if (snapshot === null) return [];
	const ids = new Set(
		snapshot.connections
			.filter(
				(connection) => connection.state === "connected" && connection.enabled,
			)
			.map((connection) => connection.pluginId),
	);
	return snapshot.catalog
		.filter((plugin) => ids.has(plugin.id))
		.map(({ id, name, domain }) => ({ id, name, domain }));
};

/** The account whose plugins apply, or null when signed out. */
export function usePluginAccount(): string | null {
	const { isSignedIn, user } = useAuth();
	return isSignedIn ? (user?.id ?? null) : null;
}

/**
 * Enabled, connected personal plugins for `@` menus and tool rows; empty while
 * signed out. Reads the shared plugin snapshot cache (agent sessions use
 * personal connections only).
 */
export function useConnectedPlugins(): readonly ConnectedPlugin[] {
	const { snapshot } = usePluginSnapshot(usePluginAccount());
	return useMemo(() => connectedOf(snapshot), [snapshot]);
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
	const plugins = useConnectedPlugins();
	return plugins.find((item) => item.id === pluginId) ?? null;
}
