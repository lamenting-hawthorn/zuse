import "@zuse/i18n/english/settings";
import type { CloudAccountImage, CloudProviderOption } from "@zuse/contracts";
import { useMessages } from "@zuse/i18n/react";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cloudProviderLabel } from "../../lib/cloud-provider-presentation.ts";
import { Badge } from "../ui/badge.tsx";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogPanel,
	DialogPopup,
	DialogTitle,
} from "../ui/dialog.tsx";
import { CloudImageBuildHistory } from "./cloud-image-build-history.tsx";

export function CloudImageProviders({
	providers,
	images,
}: {
	readonly providers: readonly CloudProviderOption[];
	readonly images: readonly CloudAccountImage[];
}) {
	const { message } = useMessages(["settings"]);
	const [selected, setSelected] = useState<string | null>(null);
	const selectedImage = images.find((image) => image.providerId === selected);
	const status = (image: CloudAccountImage | undefined) => (
		<Badge
			variant={
				image?.state === "ready"
					? "success"
					: image?.state === "failed" || image?.state === "auth-broken"
						? "error"
						: "warning"
			}
		>
			{message(`settings:cloud_images_state_${image?.state ?? "checking"}`)}
		</Badge>
	);
	return (
		<>
			<div className="space-y-1 px-3 py-2">
				{providers.map((provider) => {
					const image = images.find(
						(image) => image.providerId === provider.providerId,
					);
					return (
						<button
							key={provider.providerId}
							type="button"
							className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							aria-haspopup="dialog"
							onClick={() => setSelected(provider.providerId)}
						>
							<span className="flex-1 font-medium">
								{cloudProviderLabel(provider.providerId)}
							</span>
							{status(image)}
							<ChevronRight
								className="size-3.5 text-muted-foreground"
								aria-hidden
							/>
						</button>
					);
				})}
			</div>
			<Dialog
				open={selected !== null}
				onOpenChange={(open) => {
					if (!open) setSelected(null);
				}}
			>
				<DialogPopup className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{selected === null ? "" : cloudProviderLabel(selected)}
						</DialogTitle>
						<DialogDescription>
							{message("settings:cloud_images_details_description")}
						</DialogDescription>
					</DialogHeader>
					<DialogPanel>
						<div className="px-3 py-2">{status(selectedImage)}</div>
						{selectedImage !== undefined && selectedImage.builds.length > 0 ? (
							<CloudImageBuildHistory
								key={selected}
								builds={selectedImage.builds}
								expandLatest
							/>
						) : (
							<p className="px-3 py-2 text-xs text-muted-foreground">
								{message("settings:cloud_images_no_builds")}
							</p>
						)}
					</DialogPanel>
				</DialogPopup>
			</Dialog>
		</>
	);
}
