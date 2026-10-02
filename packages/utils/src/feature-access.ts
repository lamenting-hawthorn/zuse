/** Temporary account rollout flag. Identity must come from the authenticated Zuse session. */
export const canUseExperimentalHarness = (
	email: string | null | undefined,
): boolean => email?.trim().toLowerCase() === "mrfranklenstein@gmail.com";
