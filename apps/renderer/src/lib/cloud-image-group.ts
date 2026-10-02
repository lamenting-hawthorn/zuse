import type { CloudAccountImage } from "@zuse/contracts";

/** Requests can finish out of order. Build revisions, not arrival order, win. */
export const reconcileCloudImages = (
	current: readonly CloudAccountImage[],
	incoming: readonly CloudAccountImage[],
): readonly CloudAccountImage[] => {
	const revision = (image: CloudAccountImage) =>
		Math.max(image.updatedAt, ...image.builds.map((build) => build.updatedAt));
	return incoming.map((image) => {
		const previous = current.find(
			(item) => item.providerId === image.providerId,
		);
		return previous && revision(previous) > revision(image) ? previous : image;
	});
};

/** Readiness for a particular repository, not just a completed setup wizard. */
export const cloudImageReadyForProject = (
	image: CloudAccountImage | undefined,
	projectId: string | undefined,
): boolean =>
	projectId !== undefined &&
	(image?.state === "ready" || image?.state === "outdated") &&
	image.repositories.some((repository) => repository.projectId === projectId);

/** A group is ready only when every currently available provider is ready. */
export const cloudImageGroupStatus = (
	providerIds: readonly string[],
	images: readonly CloudAccountImage[],
): CloudAccountImage | null => {
	const current = providerIds.map((id) =>
		images.find((image) => image.providerId === id),
	);
	if (current.length === 0 || current.some((image) => image === undefined))
		return null;
	for (const state of [
		"building",
		"auth-broken",
		"failed",
		"not-built",
		"outdated",
		"ready",
	] as const) {
		const image = current.find((image) => image?.state === state);
		if (image !== undefined) return image;
	}
	return null;
};

/** Dispatch every build even if one provider rejects its request. */
export const rebuildCloudImages = async (
	providerIds: readonly string[],
	build: (providerId: string) => Promise<CloudAccountImage>,
) => {
	const ids = [...new Set(providerIds)];
	const results = await Promise.allSettled(
		ids.map((id) => Promise.resolve().then(() => build(id))),
	);
	return {
		images: results.flatMap((result) =>
			result.status === "fulfilled" ? [result.value] : [],
		),
		failedProviderIds: ids.filter(
			(_, index) => results[index]?.status === "rejected",
		),
	};
};
