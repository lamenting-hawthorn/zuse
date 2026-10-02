import {
	ModelConnectionError,
	type ModelConnectionStatus,
	type ModelSignInEvent,
} from "@zuse/contracts";
import { Context, Effect, Stream } from "effect";
import { ChatGPTAuthError, type ChatGPTOAuth } from "./chatgpt-oauth.ts";
import { GrokOAuth } from "./grok-oauth.ts";

export interface ModelConnectionsShape {
	/** Server-only access for the model broker; deliberately absent from RPCs. */
	readonly credential: (id: string) => Effect.Effect<
		{
			connectionId: string;
			accessToken: string;
			provider?: "chatgpt" | "supergrok";
		},
		ModelConnectionError
	>;

	readonly status: () => Effect.Effect<
		ModelConnectionStatus,
		ModelConnectionError
	>;
	readonly connect: (
		id?: string,
		provider?: "chatgpt" | "supergrok",
		storage?: "local" | "account",
	) => Stream.Stream<ModelSignInEvent, ModelConnectionError>;
	readonly rename: (
		id: string,
		name: string,
	) => Effect.Effect<void, ModelConnectionError>;
	readonly preferred: (id: string) => Effect.Effect<void, ModelConnectionError>;
	readonly disconnect: (
		id: string,
	) => Effect.Effect<{ revoked: boolean }, ModelConnectionError>;
	readonly acknowledgePlan: (
		id: string,
	) => Effect.Effect<void, ModelConnectionError>;
}
export class ModelConnections extends Context.Service<
	ModelConnections,
	ModelConnectionsShape
>()("@zusehq/server/harness/ModelConnections") {}
const safeError = (cause: unknown): ModelConnectionError => {
	if (cause instanceof ChatGPTAuthError) {
		switch (cause.code) {
			case "unavailable":
			case "cancelled":
			case "timeout":
			case "unknown_registration":
			case "invalid_name":
			case "access_denied":
			case "invalid_callback":
			case "identity_mismatch":
			case "verification_failed":
			case "reauthorization_required":
			case "temporarily_unavailable":
				return new ModelConnectionError({ code: cause.code });
			default:
				return new ModelConnectionError({ code: "verification_failed" });
		}
	}
	return new ModelConnectionError({ code: "storage_failed" });
};
/** One scoped login at a time; unsubscription closes the loopback listener. */
export function makeModelConnections(
	auth: ChatGPTOAuth,
	available: boolean,
	grok?: GrokOAuth,
	chatgptAvailable = true,
): ModelConnectionsShape {
	let signingIn = false;
	const owner = (id: string) =>
		id.startsWith("supergrok:") && grok ? grok : auth;
	const run = <A>(
		operation: () => Promise<A>,
	): Effect.Effect<A, ModelConnectionError> =>
		available
			? Effect.tryPromise({ try: operation, catch: safeError })
			: Effect.fail(new ModelConnectionError({ code: "unavailable" }));
	return {
		credential: (id) =>
			run(async () => ({
				...(await owner(id).credential(id)),
				provider: id.startsWith("supergrok:")
					? ("supergrok" as const)
					: ("chatgpt" as const),
			})),
		status: () =>
			available
				? run(async () => ({
						available: true,
						chatgptAvailable,
						supergrokAvailable: !!grok?.clientId,
						connections: [
							...(chatgptAvailable ? await auth.list() : []),
							...((await grok?.list()) ?? []),
						].sort(
							(a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
						),
					}))
				: Effect.succeed({ available: false, connections: [] }),
		connect: (id, provider = "chatgpt") =>
			Stream.unwrap(
				Effect.gen(function* () {
					if (!available)
						return yield* Effect.fail(
							new ModelConnectionError({ code: "unavailable" }),
						);
					yield* Effect.acquireRelease(
						Effect.gen(function* () {
							if (signingIn)
								return yield* Effect.fail(
									new ModelConnectionError({ code: "busy" }),
								);
							signingIn = true;
						}),
						() =>
							Effect.sync(() => {
								signingIn = false;
							}),
					);
					const selected = id
						? owner(id)
						: provider === "supergrok"
							? grok
							: auth;
					if (!selected || (selected === auth && !chatgptAvailable))
						return yield* Effect.fail(
							new ModelConnectionError({ code: "unavailable" }),
						);
					const flow = yield* Effect.acquireRelease(
						run(async () => {
							if (selected instanceof GrokOAuth) return selected.connect(id);
							const chatgpt = await selected.connect(id);
							return {
								...chatgpt,
								event: { _tag: "url" as const, url: chatgpt.url },
							};
						}),
						(flow) => Effect.sync(() => flow.cancel()),
					);
					return Stream.concat(
						Stream.make(flow.event),
						Stream.fromEffect(
							run(async () => ({
								_tag: "connected" as const,
								connection: await flow.finished,
							})),
						),
					);
				}),
			),
		rename: (id, name) => run(() => owner(id).rename(id, name)),
		preferred: (id) => run(() => owner(id).preferred(id)),
		disconnect: (id) => run(() => owner(id).disconnect(id)),
		acknowledgePlan: (id) => run(() => owner(id).acknowledgePlan(id)),
	};
}
