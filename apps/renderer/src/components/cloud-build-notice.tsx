import {
	CLOUD_CHECKOUT_STARTED,
	requestCloudOnboarding,
} from "../lib/cloud-onboarding.ts";
import "@zuse/i18n/english/shell";
import type { CloudAccountImage } from "@zuse/contracts";
import { useMessages } from "@zuse/i18n/react";
import { useEffect, useState } from "react";
import { useAuth } from "../hooks/use-auth.ts";
import {
	cloudImageNeedsBuild,
	refreshCloudImages,
	resetCloudImageMonitor,
	subscribeCloudImages,
} from "../lib/cloud-image-monitor.ts";
import { cloudProviderLabel } from "../lib/cloud-provider-presentation.ts";
import { useUiStore } from "../store/ui.ts";
import { Button } from "./ui/button.tsx";

/** App-owned polling survives closing Settings and reconnects after sleep. */
export function CloudBuildNotice({
	hidden = false,
}: {
	readonly hidden?: boolean;
}) {
	const { message: uiMessage } = useMessages(["shell"]);
	const { isSignedIn, user } = useAuth();
	const inCloudSettings = useUiStore(
		(state) =>
			state.view === "settings" && state.settingsSection.kind === "machines",
	);
	const [images, setImages] = useState<readonly CloudAccountImage[]>([]);
	const [unavailable, setUnavailable] = useState(false);
	const [completed, setCompleted] = useState(false);
	useEffect(() => {
		resetCloudImageMonitor();
		setImages([]);
		setCompleted(false);
		if (!isSignedIn) return;
		let disposed = false;
		let running = false;
		let wasBuilding = false;
		let checkoutUntil = 0;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			if (running || disposed) return;
			clearTimeout(timer);
			running = true;
			let building = wasBuilding;
			try {
				const next = await refreshCloudImages();
				if (disposed) return;
				if (next.length > 0) checkoutUntil = 0;
				building = next.some((image) => image.state === "building");
				if (wasBuilding && !building) setCompleted(true);
				wasBuilding = building;
				setImages(next);
				setUnavailable(false);
			} catch {
				if (!disposed) setUnavailable(true);
			} finally {
				running = false;
				if (!disposed)
					timer = setTimeout(
						() => void poll(),
						building || Date.now() < checkoutUntil ? 2_000 : 15_000,
					);
			}
		};
		const unsubscribe = subscribeCloudImages((next) => {
			if (disposed) return;
			setImages(next);
			if (next.some((image) => image.state === "building")) wasBuilding = true;
			if (next.some((image) => image.state === "building") && !running) {
				clearTimeout(timer);
				timer = setTimeout(() => void poll(), 2_000);
			}
		});
		void poll();
		const wake = () => void poll();
		const checkout = () => {
			checkoutUntil = Date.now() + 10 * 60_000;
			wake();
		};
		window.addEventListener(CLOUD_CHECKOUT_STARTED, checkout);
		window.addEventListener("focus", wake);
		window.addEventListener("online", wake);
		return () => {
			disposed = true;
			unsubscribe();
			clearTimeout(timer);
			window.removeEventListener(CLOUD_CHECKOUT_STARTED, checkout);
			window.removeEventListener("focus", wake);
			window.removeEventListener("online", wake);
			resetCloudImageMonitor();
		};
	}, [isSignedIn, user?.id]);
	const pending = images.filter(
		(image) =>
			image.state === "building" ||
			(cloudImageNeedsBuild(image) &&
				(image.state !== "not-built" ||
					!images.some((candidate) => candidate.generation !== undefined))),
	);
	// Keep polling mounted across navigation, but never overlay the chat composer.
	if (
		hidden ||
		!inCloudSettings ||
		!isSignedIn ||
		(pending.length === 0 && !completed)
	)
		return null;
	return (
		<div
			role="status"
			className="fixed bottom-3 left-1/2 z-40 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-lg bg-popover px-3 py-2 text-xs shadow-lg"
		>
			<div className="min-w-0">
				<p className="font-medium">
					{pending.length === 0
						? uiMessage("shell:cloud_build_ready")
						: pending
								.map(
									(image) =>
										`${cloudProviderLabel(image.providerId ?? "Cloud")}: ${image.state === "building" ? uiMessage("shell:cloud_build_progress", { phase: image.progressPhase ?? uiMessage("shell:cloud_build_preparing") }) : image.state === "failed" ? uiMessage("shell:cloud_build_failed") : image.state === "auth-broken" ? uiMessage("shell:cloud_build_auth") : uiMessage("shell:cloud_build_needed")}`,
								)
								.join(" · ")}
				</p>
				<p className="text-[11px] text-muted-foreground">
					{unavailable
						? uiMessage("shell:cloud_build_reconnecting")
						: pending.length === 0
							? uiMessage("shell:cloud_build_ready_description")
							: uiMessage("shell:cloud_build_background")}
				</p>
			</div>
			<Button
				className="h-7 shrink-0"
				size="xs"
				onClick={() => {
					if (images.every((image) => image.generation === undefined)) {
						requestCloudOnboarding();
						return;
					}
					useUiStore.getState().setSettingsSection({ kind: "machines" });
					useUiStore.getState().setView("settings");
					setCompleted(false);
				}}
			>
				{uiMessage("shell:cloud_build_setup")}
			</Button>
			{pending.length === 0 ? (
				<Button
					className="h-7"
					size="xs"
					variant="ghost"
					onClick={() => setCompleted(false)}
				>
					{uiMessage("shell:cloud_build_dismiss")}
				</Button>
			) : null}
		</div>
	);
}
