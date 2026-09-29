import type { CloudAccountImage } from "@zuse/contracts";

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
