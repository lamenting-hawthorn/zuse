import type { WorkspaceScope } from "@zuse/contracts";
import { Effect } from "effect";
import type { getCloudControlClient } from "./cloud-control-client.ts";
import {
	assertRendererAccountCurrent,
	rendererAccountSnapshot,
	subscribeRendererAccount,
} from "./renderer-account.ts";
import {
	assertRendererWorkspaceCurrent,
	rendererWorkspaceSnapshot,
} from "./renderer-workspace.ts";
import { getControlPlaneRpcClient, type MemoizeClient } from "./rpc-client.ts";

/** Single renderer boundary for API account and workspace lifecycle RPCs. */
const runScopedControlPlane = async <Client, Result>(
	getClient: (scope: WorkspaceScope) => Promise<Client>,
	effect: (client: Client) => Effect.Effect<Result, unknown>,
	options?: { readonly scope?: "account" },
): Promise<Result> => {
	const account = rendererAccountSnapshot();
	const workspace = rendererWorkspaceSnapshot();
	const client = await getClient(
		options?.scope === "account" ? { kind: "personal" } : workspace.scope,
	);
	assertRendererAccountCurrent(account);
	if (options?.scope !== "account") assertRendererWorkspaceCurrent(workspace);
	try {
		return await Effect.runPromise(effect(client));
	} finally {
		assertRendererAccountCurrent(account);
		if (options?.scope !== "account") assertRendererWorkspaceCurrent(workspace);
	}
};

export const runControlPlane = <Result>(
	effect: (client: MemoizeClient) => Effect.Effect<Result, unknown>,
	options?: { readonly scope?: "account" },
): Promise<Result> =>
	runScopedControlPlane(getControlPlaneRpcClient, effect, options);

export const runCloudControl = <Result>(
	effect: (
		client: Awaited<ReturnType<typeof getCloudControlClient>>,
	) => Effect.Effect<Result, unknown>,
): Promise<Result> =>
	runScopedControlPlane(
		async (scope) =>
			(await import("./cloud-control-client.ts")).getCloudControlClient(scope),
		effect,
	);

export const controlPlaneClient = (): Promise<MemoizeClient> =>
	getControlPlaneRpcClient();

type SessionCacheEntry = Readonly<{
	promise: Promise<unknown>;
	expiresAt: number;
}>;

const sessionCaches = new Map<string, Map<string, SessionCacheEntry>>();
subscribeRendererAccount(() => sessionCaches.clear());

export const subscribeControlPlaneSessionCache = (
	listener: (key: string) => void,
): (() => void) => {
	cacheListeners.add(listener);
	return () => {
		cacheListeners.delete(listener);
	};
};

/** Successful reads stay cached for the renderer session until explicitly refreshed
 * or cleared on account changes. Reads during a refresh retain the last value.
 */
export const runCachedControlPlane = <Result>(
	key: string,
	effect: (
		client: Awaited<ReturnType<typeof getCloudControlClient>>,
	) => Effect.Effect<Result, unknown>,
	options?: { readonly refresh?: boolean; readonly maxAgeMs?: number },
): Promise<Result> => {
	const account = rendererAccountSnapshot();
	const workspace = rendererWorkspaceSnapshot();
	const partition = JSON.stringify([
		account.subject,
		account.epoch,
		workspace.key,
	]);
	let sessionCache = sessionCaches.get(partition);
	if (sessionCache === undefined) {
		sessionCache = new Map();
		sessionCaches.set(partition, sessionCache);
	}
	const cache = sessionCache;
	if (!options?.refresh) {
		const cached = cache.get(key);
		if (cached !== undefined && cached.expiresAt > Date.now()) {
			return cached.promise.then((value) => {
				assertRendererAccountCurrent(account);
				assertRendererWorkspaceCurrent(workspace);
				return value as Result;
			});
		}
	}

	const request = runCloudControl(effect).catch((cause) => {
		if (cache.get(key)?.promise === request) cache.delete(key);
		throw cause;
	});
	cache.set(key, {
		promise: request,
		expiresAt:
			options?.maxAgeMs === undefined
				? Number.POSITIVE_INFINITY
				: Date.now() + options.maxAgeMs,
	});
	return request;
};

export const clearControlPlaneSessionCache = (prefix?: string): void => {
	if (prefix === undefined) {
		sessionCaches.clear();
		return;
	}
	for (const cache of sessionCaches.values()) {
		for (const key of cache.keys()) {
			if (key.startsWith(prefix)) cache.delete(key);
		}
	}
};
