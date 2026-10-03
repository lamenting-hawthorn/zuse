import type { ProviderId } from "@zuse/contracts";

import {
	PROVIDER_LABELS as PROVIDER_LABEL,
	providerLabel,
} from "@zuse/contracts";
import { currentModelCatalog } from "../store/model-catalog.ts";

export { PROVIDER_LABELS as PROVIDER_LABEL } from "@zuse/contracts";

export const PROVIDER_SHORT_LABEL: Readonly<Record<ProviderId, string>> = {
	...PROVIDER_LABEL,
	claude: "Claude",
};

/** Display name for any provider, including user-configured ACP agents. */
export const providerDisplayName = (providerId: ProviderId): string =>
	PROVIDER_LABEL[providerId] ??
	currentModelCatalog().providers[providerId]?.displayName ??
	providerLabel(providerId);
