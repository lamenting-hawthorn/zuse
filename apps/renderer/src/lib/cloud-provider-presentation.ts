import "@zuse/i18n/english/chat";
import type { CloudProviderOption, CloudProviderSize } from "@zuse/contracts";
import { formatNumber, message } from "@zuse/i18n";

const LOCALIZED_SIZE_PROVIDERS = new Set(["box", "boxd"]);

export const cloudProviderSizeLabel = (
	providerId: string,
	size: CloudProviderSize,
): string => {
	if (
		!LOCALIZED_SIZE_PROVIDERS.has(providerId) ||
		(size.sizeId !== "small" &&
			size.sizeId !== "default" &&
			size.sizeId !== "large")
	)
		return size.displayName;
	return message(`chat:cloud_size_${size.sizeId}`, {
		cpu: formatNumber(size.vcpuCount),
		memory: formatNumber(size.memoryMib / 1024),
	});
};

export const cloudProviderLabel = (providerId: string): string =>
	providerId === "box"
		? "Boat"
		: providerId === "boxd"
			? "boxd"
			: providerId === "e2b"
				? "E2B"
				: providerId;

/** Keep server ordering for other providers, with boxd recommended first. */
export const orderedCloudProviders = (
	providers: readonly CloudProviderOption[],
) =>
	[...providers].sort(
		(a, b) => Number(b.providerId === "boxd") - Number(a.providerId === "boxd"),
	);

export const selectedCloudProvider = (
	providers: readonly CloudProviderOption[],
	selected: string | null,
): string | null =>
	providers.find((provider) => provider.providerId === selected)?.providerId ??
	orderedCloudProviders(providers)[0]?.providerId ??
	null;
