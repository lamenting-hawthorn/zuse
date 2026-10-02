import type { ProviderId } from "@zuse/contracts";

import { PROVIDER_LABELS as PROVIDER_LABEL } from "@zuse/contracts";

export { PROVIDER_LABELS as PROVIDER_LABEL } from "@zuse/contracts";

export const PROVIDER_SHORT_LABEL: Readonly<Record<ProviderId, string>> = {
	...PROVIDER_LABEL,
	claude: "Claude",
};
