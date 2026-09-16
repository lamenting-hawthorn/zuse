import type { ChatId, FolderId } from "@zuse/contracts";
import { Context, Effect, Stream } from "effect";

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
