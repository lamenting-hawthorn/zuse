import type { CloudChatSummary, ForkDestination } from "@zuse/contracts";

/** A cloud chat fork owns a machine; a local chat fork owns a worktree. */
export const sessionForkDestinations = (
	cloud: Pick<CloudChatSummary, "providerId" | "state"> | null,
	fixedDestination?: ForkDestination,
): ReadonlyArray<ForkDestination> => {
	if (
		cloud !== null &&
		(cloud.providerId !== "boxd" ||
			cloud.state === "archived" ||
			cloud.state === "archiving" ||
			cloud.state === "deleted" ||
			cloud.state === "deleting")
	)
		return [];
	const destinations: ReadonlyArray<ForkDestination> = ["tab", "chat"];
	return fixedDestination === undefined
		? destinations
		: destinations.filter((destination) => destination === fixedDestination);
};
