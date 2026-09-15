import type { ChatId, FolderId } from "@zuse/contracts";
import { Context, Effect } from "effect";

/** Installed only by the RPC boundary after verifying the account identity. */
export class CatalogVisibility extends Context.Service<
	CatalogVisibility,
	{
		readonly chats: ReadonlySet<ChatId>;
		readonly projects: ReadonlySet<FolderId>;
	}
>()("zuse/collaboration/CatalogVisibility") {}

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
