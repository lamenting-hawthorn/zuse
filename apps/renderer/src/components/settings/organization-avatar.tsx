import { DitherAvatar } from "@repo/ui/dither";

/**
 * Dithered identity for organization settings rows. Seed with a stable id so
 * the same organization, person, or GitHub account looks the same everywhere.
 */
export function OrganizationAvatar({ seed }: { seed: string }) {
	return (
		<span aria-hidden className="block">
			<DitherAvatar name={seed} size={28} className="rounded-md bg-muted/40" />
		</span>
	);
}
