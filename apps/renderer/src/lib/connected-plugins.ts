import type { PluginDefinition, PluginSnapshot } from "@zuse/contracts";
import { useEffect, useState } from "react";
import { useAuth } from "../hooks/use-auth.ts";
import { onPluginsChanged, pluginRequest } from "./plugins-client.ts";

/** Plugins the signed-in account can use right now, for `@` mentions. */
export type ConnectedPlugin = Pick<PluginDefinition, "id" | "name" | "domain">;

const FRESH_MS = 30_000;
/** Cached per signed-in account so a switch never shows another account's plugins. */
let cached: {
	account: string;
	at: number;
	plugins: readonly ConnectedPlugin[];
} | null = null;
let inflight: {
	account: string;
	promise: Promise<readonly ConnectedPlugin[]>;
} | null = null;

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
export const rememberPluginSnapshot = (
	account: string,
	snapshot: PluginSnapshot,
) => {
	if (!snapshot.tenantId.startsWith("personal:")) return;
	cached = { account, at: Date.now(), plugins: connectedOf(snapshot) };
};

onPluginsChanged(() => {
	cached = null;
});

/**
 * Connected plugins for the signed-in account, cached briefly: the catalog
 * snapshot is large and the `@` menu opens often. Signed out means none, with
 * no request; failures (offline) also mean none.
 */
export function loadConnectedPlugins(
	account: string | null,
): Promise<readonly ConnectedPlugin[]> {
	if (account === null) return Promise.resolve([]);
	if (
		cached !== null &&
		cached.account === account &&
		Date.now() - cached.at < FRESH_MS
	)
		return Promise.resolve(cached.plugins);
	if (inflight?.account === account) return inflight.promise;
	const promise = pluginRequest({ action: "list" })
		.then((result) => {
			if (result.kind !== "snapshot") return [];
			rememberPluginSnapshot(account, result);
			return connectedOf(result);
		})
		.catch(() => [])
		.finally(() => {
			if (inflight?.promise === promise) inflight = null;
		});
	inflight = { account, promise };
	return promise;
}

/** The account whose plugins apply, or null when signed out. */
export function usePluginAccount(): string | null {
	const { isSignedIn, user } = useAuth();
	return isSignedIn ? (user?.id ?? null) : null;
}

/** Connected plugins for `@` menus; empty while signed out. */
export function useConnectedPlugins(): readonly ConnectedPlugin[] {
	const account = usePluginAccount();
	const [plugins, setPlugins] = useState<readonly ConnectedPlugin[]>(() =>
		cached !== null && cached.account === account ? cached.plugins : [],
	);
	useEffect(() => {
		let cancelled = false;
		void loadConnectedPlugins(account).then((value) => {
			if (!cancelled) setPlugins(value);
		});
		return () => {
			cancelled = true;
		};
	}, [account]);
	return plugins;
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
	const account = usePluginAccount();
	const [plugin, setPlugin] = useState<ConnectedPlugin | null>(() =>
		cached !== null && cached.account === account
			? (cached.plugins.find((item) => item.id === pluginId) ?? null)
			: null,
	);
	useEffect(() => {
		if (pluginId === null) return;
		let cancelled = false;
		void loadConnectedPlugins(account).then((plugins) => {
			if (!cancelled)
				setPlugin(plugins.find((item) => item.id === pluginId) ?? null);
		});
		return () => {
			cancelled = true;
		};
	}, [account, pluginId]);
	return plugin;
}
