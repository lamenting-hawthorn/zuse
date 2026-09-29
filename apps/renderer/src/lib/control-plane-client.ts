import { Effect } from "effect";
import { hostedAccountId, isHostedProduct } from "./hosted-connect.ts";

import {
	type ControlPlaneClient,
	getControlPlaneRpcClient,
} from "./rpc-client.ts";

/** Single renderer boundary for API account and workspace lifecycle RPCs. */
export const runControlPlane = async <Result>(
	effect: (client: ControlPlaneClient) => Effect.Effect<Result, unknown>,
): Promise<Result> => {
	const client = await getControlPlaneRpcClient();
	return Effect.runPromise(effect(client));
};

type SessionCacheEntry = {
	value?: Promise<unknown>;
	snapshot?: unknown;
	checkedAt?: number;
	pending?: Promise<unknown>;
};

const sessionCache = new Map<string, SessionCacheEntry>();
const cacheListeners = new Set<(key: string) => void>();

// Persist only explicitly opted-in, schema-validated display data.
export type ControlPlaneCacheOptions<Result> = {
	readonly refresh?: boolean;
	readonly decode?: (value: unknown) => Result;
};
let accountId: string | null = null;
export const setControlPlaneCacheAccount = (id: string | null): void => {
	accountId = id;
};
const cacheScope = () => (isHostedProduct() ? hostedAccountId() : accountId);
const storageKey = (key: string) => {
	const scope = cacheScope();
	return scope === null
		? null
		: `zuse.control-plane.v1:${encodeURIComponent(scope)}:${key}`;
};
const entryKey = (key: string) =>
	`${encodeURIComponent(cacheScope() ?? "anonymous")}:${key}`;
const readEntry = <Result>(
	key: string,
	options?: ControlPlaneCacheOptions<Result>,
): SessionCacheEntry | undefined => {
	const memoryKey = entryKey(key);
	const existing = sessionCache.get(memoryKey);
	if (existing || !options?.decode) return existing;
	const storedKey = storageKey(key);
	if (storedKey === null) return undefined;
	try {
		const raw = window.localStorage.getItem(storedKey);
		if (raw === null) return undefined;
		const stored = JSON.parse(raw);
		const snapshot = options.decode(stored.value);
		const entry = {
			snapshot,
			value: Promise.resolve(snapshot),
			checkedAt: undefined,
		};
		sessionCache.set(memoryKey, entry);
		return entry;
	} catch {
		return undefined;
	}
};
export const peekControlPlaneCache = <Result>(
	key: string,
	decode: (value: unknown) => Result,
): Result | undefined =>
	readEntry(key, { decode })?.snapshot as Result | undefined;

export const subscribeControlPlaneSessionCache = (
	listener: (key: string) => void,
): (() => void) => {
	cacheListeners.add(listener);
	return () => {
		cacheListeners.delete(listener);
	};
};

/** Successful reads stay cached for the renderer session until explicitly refreshed
 * or cleared on account changes. Opted-in display snapshots persist across reloads
 * and revalidate in the background, at most once every five minutes per session.
 * Restored snapshots revalidate on their first read. Failed refreshes retain data.
 */
export const runCachedControlPlane = <Result>(
	key: string,
	effect: (client: ControlPlaneClient) => Effect.Effect<Result, unknown>,
	options?: ControlPlaneCacheOptions<Result>,
): Promise<Result> => {
	const memoryKey = entryKey(key);
	const persistedKey = options?.decode ? storageKey(key) : null;
	const previous = readEntry(key, options);
	// A refresh after a mutation must not join a read started before that write.
	const entry: SessionCacheEntry = options?.refresh
		? {
				value: previous?.value,
				snapshot: previous?.snapshot,
				checkedAt: previous?.checkedAt,
			}
		: (previous ?? {});
	const cached = entry.value as Promise<Result> | undefined;
	const stale =
		options?.decode &&
		(entry.checkedAt === undefined ||
			Date.now() - entry.checkedAt >= 5 * 60_000);
	if (!options?.refresh && cached && !stale) return cached;
	if (!entry.pending) {
		sessionCache.set(memoryKey, entry);
		const request = runControlPlane(effect).then(
			(value) => {
				if (
					sessionCache.get(memoryKey) === entry &&
					entryKey(key) === memoryKey
				) {
					const changed =
						!options?.decode ||
						JSON.stringify(entry.snapshot) !== JSON.stringify(value);
					if (changed) entry.snapshot = value;
					entry.checkedAt = Date.now();
					entry.value = Promise.resolve(entry.snapshot);
					if (persistedKey !== null) {
						try {
							window.localStorage.setItem(
								persistedKey,
								JSON.stringify({ value: entry.snapshot }),
							);
						} catch {
							/* Best-effort cache. */
						}
					}
					entry.pending = undefined;
					if (changed) for (const listener of cacheListeners) listener(key);
				}
				return value;
			},
			(cause) => {
				if (
					sessionCache.get(memoryKey) === entry &&
					entryKey(key) === memoryKey
				) {
					entry.pending = undefined;
					entry.checkedAt = Date.now();
					if (!entry.value) sessionCache.delete(memoryKey);
				}
				throw cause;
			},
		);
		entry.pending = request;
	}
	if (!options?.refresh && cached) {
		void entry.pending.catch(() => undefined);
		return cached;
	}
	return entry.pending as Promise<Result>;
};

/** Discard a display snapshot after a write, including its persisted copy. */
export const invalidateControlPlaneCache = (key: string): void => {
	sessionCache.delete(entryKey(key));
	const persistedKey = storageKey(key);
	if (persistedKey !== null) {
		try {
			window.localStorage.removeItem(persistedKey);
		} catch {
			/* Best-effort cache. */
		}
	}
};

export const clearControlPlaneSessionCache = (prefix?: string): void => {
	if (prefix === undefined) {
		sessionCache.clear();
		return;
	}
	for (const key of sessionCache.keys()) {
		if (key.includes(`:${prefix}`)) sessionCache.delete(key);
	}
};
