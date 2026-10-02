import type { LoginEvent, ProviderId } from "@zuse/contracts";
import { Effect, Fiber, Stream } from "effect";
import { useEffect, useRef } from "react";

import { createAtomStore } from "../state/atom-store.ts";
import { getRpcClient } from "./rpc-client";

export type ProviderLoginState =
	| { readonly kind: "idle" }
	| { readonly kind: "waiting"; readonly url: string | null }
	| { readonly kind: "success" }
	| { readonly kind: "failed"; readonly reason: string };

const PROVIDERS_WITH_INLINE_LOGIN: ReadonlySet<ProviderId> =
	new Set<ProviderId>(["claude", "grok"]);

export const supportsProviderLogin = (providerId: ProviderId): boolean =>
	PROVIDERS_WITH_INLINE_LOGIN.has(providerId);

/**
 * Open a URL in the user's OS browser via the preload bridge (Electron's
 * `shell.openExternal`). Falls back to `window.open` for web/dev contexts.
 * We intentionally avoid an in-app webview here: an OAuth flow needs the
 * user's real browser session, password manager, and cookies.
 */
export const openExternal = (url: string): void => {
	const bridge = window.zuse?.app;
	if (bridge !== undefined) {
		bridge.openExternal(url);
		return;
	}
	window.open(url, "_blank", "noopener,noreferrer");
};

type ProviderLoginStore = {
	readonly stateByProvider: Partial<Record<ProviderId, ProviderLoginState>>;
};

const IDLE_LOGIN: ProviderLoginState = { kind: "idle" };
const SUCCESS_SETTLE_MS = 4_000;
const loginStore = createAtomStore<ProviderLoginStore>(() => ({
	stateByProvider: {},
}));
const loginFibers = new Map<ProviderId, Fiber.Fiber<unknown, unknown>>();
const loginSettleTimers = new Map<ProviderId, ReturnType<typeof setTimeout>>();

const setLoginState = (providerId: ProviderId, state: ProviderLoginState) =>
	loginStore.setState((current) => ({
		stateByProvider: { ...current.stateByProvider, [providerId]: state },
	}));

const interruptLogin = (providerId: ProviderId): void => {
	const fiber = loginFibers.get(providerId);
	loginFibers.delete(providerId);
	if (fiber !== undefined) void Effect.runPromise(Fiber.interrupt(fiber));
	const timer = loginSettleTimers.get(providerId);
	if (timer !== undefined) clearTimeout(timer);
	loginSettleTimers.delete(providerId);
};

const cancelProviderLogin = (providerId: ProviderId): void => {
	interruptLogin(providerId);
	setLoginState(providerId, IDLE_LOGIN);
};

const startProviderLogin = async (providerId: ProviderId): Promise<void> => {
	if (loginStore.getState().stateByProvider[providerId]?.kind === "waiting")
		return;
	interruptLogin(providerId);
	setLoginState(providerId, { kind: "waiting", url: null });
	let client: Awaited<ReturnType<typeof getRpcClient>>;
	try {
		client = await getRpcClient();
	} catch (err) {
		setLoginState(providerId, {
			kind: "failed",
			reason: err instanceof Error ? err.message : String(err),
		});
		return;
	}
	// A cancel while the client was resolving wins over this attempt.
	if (loginStore.getState().stateByProvider[providerId]?.kind !== "waiting")
		return;
	const fiber = Effect.runFork(
		Stream.runForEach(
			client["provider.startLogin"]({ providerId }),
			(event: LoginEvent) =>
				Effect.sync(() => {
					if (loginFibers.get(providerId) !== fiber) return;
					if (event._tag === "url") {
						// Grok's official login command opens its own browser. Keep the
						// URL for explicit recovery without opening a duplicate tab.
						if (providerId !== "grok") openExternal(event.url);
						setLoginState(providerId, { kind: "waiting", url: event.url });
					} else if (event._tag === "done") {
						loginFibers.delete(providerId);
						if (!event.ok) {
							setLoginState(providerId, {
								kind: "failed",
								reason: event.reason ?? "Sign-in failed.",
							});
							return;
						}
						setLoginState(providerId, { kind: "success" });
						loginSettleTimers.set(
							providerId,
							setTimeout(() => {
								loginSettleTimers.delete(providerId);
								setLoginState(providerId, IDLE_LOGIN);
							}, SUCCESS_SETTLE_MS),
						);
					}
					// "log" events are diagnostic-only; ignored in the UI.
				}),
		).pipe(
			Effect.catch((err) =>
				Effect.sync(() => {
					if (loginFibers.get(providerId) !== fiber) return;
					loginFibers.delete(providerId);
					setLoginState(providerId, {
						kind: "failed",
						reason: err instanceof Error ? err.message : String(err),
					});
				}),
			),
		),
	);
	loginFibers.set(providerId, fiber);
};

/**
 * Shared one-click provider sign-in state machine. Subscribes to
 * `provider.startLogin`, which spawns the provider's `login` subcommand
 * server-side and streams progress. The first `url` event opens the OAuth page
 * when the provider CLI does not own browser launch; the terminal `done` event
 * resolves to success/failure.
 *
 * The attempt is owned per provider, not per component: switching settings
 * rows or leaving the page keeps the sign-in running and its status visible.
 * Only an explicit cancel interrupts the stream, which closes the server-side
 * scope and SIGTERMs the child process.
 *
 * Used by both the provider settings card and the inline auth ErrorBubble so
 * the flow (and its copy) stays identical wherever a user signs in. Each
 * mounted caller's `onSuccess` fires when it observes the attempt succeed.
 */
export function useProviderLogin(
	providerId: ProviderId,
	opts?: { readonly onSuccess?: () => void },
): {
	readonly state: ProviderLoginState;
	readonly start: () => Promise<void>;
	readonly cancel: () => void;
} {
	const state = loginStore(
		(current) => current.stateByProvider[providerId] ?? IDLE_LOGIN,
	);
	const onSuccessRef = useRef(opts?.onSuccess);
	onSuccessRef.current = opts?.onSuccess;
	const previousKind = useRef(state.kind);
	useEffect(() => {
		if (state.kind === "success" && previousKind.current !== "success")
			onSuccessRef.current?.();
		previousKind.current = state.kind;
	}, [state.kind]);

	return {
		state,
		start: () => startProviderLogin(providerId),
		cancel: () => cancelProviderLogin(providerId),
	};
}
