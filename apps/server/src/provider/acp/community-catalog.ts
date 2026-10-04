import type { RegistryAgent } from "./catalog.ts";

/** Published adapters not yet in the upstream registry. Upstream wins on ID collision. */
export const COMMUNITY_ACP_AGENTS: readonly RegistryAgent[] = [
	{
		id: "omp-acp",
		name: "Oh My Pi (OMP)",
		description:
			"ACP adapter for Oh My Pi. Requires Node.js 20+ and the omp CLI on this host; uses your existing OMP authentication.",
		version: "0.1.2",
		repository: "https://github.com/jiwangyihao/omp-acp",
		distribution: { npx: { package: "omp-acp@0.1.2" } },
	},
];
