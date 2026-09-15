import {
	ChatId,
	RpcAccessDeniedError,
	RpcAuthorization,
	SessionId,
	TeamId,
} from "@zuse/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { AuthService } from "../../auth/services/auth-service.ts";
import { CollaborationService } from "../../collaboration/services/collaboration-service.ts";
import { ConnectionIdentity } from "../services/connection-identity.ts";

export const RpcAuthorizationLive = Layer.effect(
	RpcAuthorization,
	Effect.gen(function* () {
		const auth = yield* AuthService;
		const sql = yield* SqlClient.SqlClient;
		const collaboration = yield* CollaborationService;
		return RpcAuthorization.of((effect, { rpc, payload }) =>
			Effect.gen(function* () {
				const identity = yield* Effect.serviceOption(ConnectionIdentity);
				// Native IPC and explicitly paired devices retain their existing host
				// authority. Account connections never inherit it from the transport.
				if (Option.isNone(identity) || identity.value.kind !== "account")
					return yield* effect;
				const account = identity.value;
				const authorize = Effect.gen(function* () {
					if (account.expiresAt <= Date.now())
						return yield* new RpcAccessDeniedError({
							code: "credential-expired",
						});
					const session = yield* auth.getSession();
					if (session._tag !== "SignedIn")
						return yield* new RpcAccessDeniedError({ code: "access-denied" });
					if (session.session.user.id === account.subject) return;
					let chatId: ChatId;
					if (rpc._tag === "chat.get") {
						chatId = (yield* Schema.decodeUnknownEffect(
							Schema.Struct({ chatId: ChatId }),
						)(payload)).chatId;
					} else {
						switch (rpc._tag) {
							case "session.get":
							case "messages.list":
							case "session.events":
							case "session.events.head":
							case "session.messages.page":
								break;
							default:
								return yield* new RpcAccessDeniedError({
									code: "access-denied",
								});
						}
						const { sessionId } = yield* Schema.decodeUnknownEffect(
							Schema.Struct({ sessionId: SessionId }),
						)(payload);
						const rows = yield* sql<{
							readonly chat_id: string;
						}>`SELECT chat_id FROM sessions WHERE id = ${sessionId}`;
						if (rows[0] === undefined)
							return yield* new RpcAccessDeniedError({ code: "access-denied" });
						chatId = ChatId.make(rows[0].chat_id);
					}
					const workspaces = yield* sql<{
						readonly team_id: string;
					}>`SELECT team_id FROM collaboration_workspaces WHERE chat_id = ${chatId}`;
					if (workspaces[0] === undefined)
						return yield* new RpcAccessDeniedError({ code: "access-denied" });
					const actor = yield* collaboration.resolveActor(
						TeamId.make(workspaces[0].team_id),
						account.subject,
					);
					yield* collaboration.requireWorkspaceRole(actor, chatId, "viewer");
				}).pipe(
					Effect.andThen(
						Effect.suspend(() =>
							account.expiresAt <= Date.now()
								? Effect.fail(
										new RpcAccessDeniedError({ code: "credential-expired" }),
									)
								: Effect.void,
						),
					),
					Effect.mapError((error) =>
						error._tag === "RpcAccessDeniedError"
							? error
							: new RpcAccessDeniedError({ code: "access-denied" }),
					),
				);
				yield* authorize;
				// Long-lived subscriptions must not retain authority after logout or
				// credential expiry. Cancellation closes the existing RPC stream.
				return yield* Effect.raceFirst(
					effect,
					Effect.forever(
						Effect.suspend(() =>
							Effect.sleep(
								Math.max(0, Math.min(20_000, account.expiresAt - Date.now())),
							),
						).pipe(Effect.andThen(authorize)),
					),
				);
			}),
		);
	}),
);
