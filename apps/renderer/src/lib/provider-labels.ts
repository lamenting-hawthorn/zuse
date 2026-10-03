import type { ProviderId } from "@zuse/contracts";

import {
	PROVIDER_LABELS as PROVIDER_LABEL,
	providerLabel,
} from "@zuse/contracts";
import {
	currentModelCatalog,
	useModelCatalogStore,
} from "../store/model-catalog.ts";

export { PROVIDER_LABELS as PROVIDER_LABEL } from "@zuse/contracts";

export const PROVIDER_SHORT_LABEL: Readonly<Record<ProviderId, string>> = {
	...PROVIDER_LABEL,
	claude: "Claude",
};

const resolveName = (providerId: ProviderId, catalogName?: string) =>
	PROVIDER_LABEL[providerId] ?? catalogName ?? providerLabel(providerId);

/** Display name for any provider, including user-configured ACP agents. */
export const providerDisplayName = (providerId: ProviderId): string =>
	resolveName(
		providerId,
		currentModelCatalog().providers[providerId]?.displayName,
	);

/** Reactive variant: re-renders once the catalog reports an ACP agent's name. */
export const useProviderDisplayName = (providerId: ProviderId): string =>
	resolveName(
		providerId,
		useModelCatalogStore(
			(state) => state.catalog.providers[providerId]?.displayName,
		),
	);
