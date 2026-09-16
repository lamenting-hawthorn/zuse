import type {
	ChatId,
	ChatSummaryChange,
	FolderId,
	SessionId,
	SessionSummaryChange,
} from "@zuse/contracts";
import { Context, Effect, Result, Stream } from "effect";

/** Installed only by the RPC boundary after verifying the account identity. */
export class CatalogVisibility extends Context.Service<
	CatalogVisibility,
	{
		readonly chats: ReadonlySet<ChatId>;
		readonly projects: ReadonlySet<FolderId>;
	}
>()("zuse/collaboration/CatalogVisibility") {}

export class CatalogVisibilityChanges extends Context.Service<
	CatalogVisibilityChanges,
	Stream.Stream<CatalogVisibility["Service"]>
>()("zuse/collaboration/CatalogVisibilityChanges") {}

/** Reopen the existing snapshot/live feed whenever its authorized scope changes. */
export const withCatalogChanges = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
	Stream.unwrap(
		Effect.serviceOption(CatalogVisibilityChanges).pipe(
			Effect.map((changes) =>
				changes._tag === "None"
					? stream
					: changes.value.pipe(
							Stream.switchMap((scope) =>
								stream.pipe(Stream.provideService(CatalogVisibility, scope)),
							),
						),
			),
		),
	);

export const filterCatalog = <A>(
	items: ReadonlyArray<A>,
	visible: (scope: CatalogVisibility["Service"], item: A) => boolean,
) =>
	Effect.serviceOption(CatalogVisibility).pipe(
		Effect.map((scope) =>
			scope._tag === "None"
				? items
				: items.filter((item) => visible(scope.value, item)),
		),
	);

export const filterChatCatalog = <E, R>(
	stream: Stream.Stream<ChatSummaryChange, E, R>,
) =>
	Stream.unwrap(
		Effect.serviceOption(CatalogVisibility).pipe(
			Effect.map((scope) =>
				scope._tag === "None"
					? stream
					: stream.pipe(
							Stream.filterMap(
								(change): Result.Result<ChatSummaryChange, undefined> => {
									if (change._tag === "snapshot")
										return Result.succeed({
											...change,
											chats: change.chats.filter((chat) =>
												scope.value.chats.has(chat.id),
											),
										});
									return scope.value.chats.has(change.chat.id)
										? Result.succeed(change)
										: Result.fail(undefined);
								},
							),
						),
			),
		),
	);

export const filterSessionCatalog = <E, R>(
	stream: Stream.Stream<SessionSummaryChange, E, R>,
) =>
	Stream.unwrap(
		Effect.serviceOption(CatalogVisibility).pipe(
			Effect.map((scope) => {
				if (scope._tag === "None") return stream;
				const known = new Set<SessionId>();
				return stream.pipe(
					Stream.filterMap(
						(change): Result.Result<SessionSummaryChange, undefined> => {
							if (change._tag === "snapshot") {
								known.clear();
								const sessions = change.sessions.filter((session) =>
									scope.value.chats.has(session.chatId),
								);
								for (const session of sessions) known.add(session.id);
								return Result.succeed({ ...change, sessions });
							}
							if (change._tag === "remove")
								return known.delete(change.sessionId)
									? Result.succeed(change)
									: Result.fail(undefined);
							if (scope.value.chats.has(change.session.chatId)) {
								known.add(change.session.id);
								return Result.succeed(change);
							}
							// If a previously visible session moves out of scope, remove its
							// old row without revealing the destination or updated contents.
							return known.delete(change.session.id)
								? Result.succeed({
										_tag: "remove",
										sequence: change.sequence,
										sessionId: change.session.id,
									})
								: Result.fail(undefined);
						},
					),
				);
			}),
		),
	);
