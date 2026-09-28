import "@zuse/i18n/english/connections";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMessages } from "@zuse/i18n/react";
import {
	Add01Icon,
	ArrowUpRight01Icon,
	ComputerCloudIcon,
	Globe02Icon,
} from "@zuse/icons/solid-rounded";
import { useState } from "react";
import { getTunnelsBridge } from "../lib/bridge.ts";
import { errorMessage } from "../lib/error-message.ts";
import { openExternal } from "../lib/platform-capabilities.ts";
import { closePreviewPortForwards } from "../lib/port-forward-client.ts";
import {
	useBoxdPreviewEnabled,
	usePreviewServers,
} from "../lib/use-preview-servers.ts";
import {
	DEFAULT_PREVIEW_SETTINGS,
	isPreviewPort,
	usePreviewSettings,
} from "../store/preview-settings.ts";
import { CopyButton } from "./copy-button.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { compactMenuItemClass } from "./ui/menu.tsx";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover.tsx";
import { Switch } from "./ui/switch.tsx";
import { toastManager } from "./ui/toast.tsx";

export function PreviewPortsMenu({
	environmentId,
}: {
	readonly environmentId: string;
}) {
	const { message } = useMessages(["connections", "common"]);
	const [open, setOpen] = useState(false);
	const [portText, setPortText] = useState("");
	const [closing, setClosing] = useState(false);
	const settings = usePreviewSettings(
		(state) => state.environments[environmentId] ?? DEFAULT_PREVIEW_SETTINGS,
	);
	const update = usePreviewSettings((state) => state.update);
	const boxd = useBoxdPreviewEnabled(environmentId);
	const servers = usePreviewServers(
		environmentId,
		open || settings.publish || settings.forward,
		boxd,
	);
	const previews = servers.filter(
		(server) => server.isWebServer === true || server.explicitlyRequested,
	);
	const port = Number(portText);
	const validPort = /^\d+$/.test(portText) && isPreviewPort(port);
	const report = (cause: unknown) =>
		toastManager.add({
			type: "error",
			title: errorMessage(cause, message("connections:preview_ports_failed")),
		});
	const toggleForwarding = async (enabled: boolean) => {
		update(environmentId, { forward: enabled });
		if (enabled) return;
		setClosing(true);
		try {
			await closePreviewPortForwards(environmentId);
		} catch (cause) {
			report(cause);
		} finally {
			setClosing(false);
		}
	};
	const linkRow = (url: string) => (
		<div key={url} className="flex h-7 min-w-0 items-center gap-1 pl-6 pr-1">
			<button
				type="button"
				className="flex h-7 min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				title={url}
				onClick={() => void openExternal(url).catch(report)}
			>
				<span className="min-w-0 flex-1 truncate text-left">
					{url.replace(/^https?:\/\//, "")}
				</span>
				<HugeiconsIcon
					icon={ArrowUpRight01Icon}
					className="size-3.5 shrink-0"
				/>
			</button>
			<CopyButton
				text={url}
				label={message("connections:cloud_workspace_menu_copy_url")}
				className="h-7 w-7"
			/>
		</div>
	);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				title={message("connections:preview_ports_title")}
				aria-label={message("connections:preview_ports_title")}
				className="[-webkit-app-region:no-drag] relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 data-[popup-open]:bg-muted/60"
			>
				<HugeiconsIcon icon={Globe02Icon} className="size-4" />
				{settings.publish || settings.forward ? (
					<span className="absolute right-1 top-1 size-1 rounded-full bg-primary" />
				) : null}
			</PopoverTrigger>
			<PopoverPopup
				align="end"
				aria-label={message("connections:preview_ports_title")}
				className="w-80 max-w-[calc(100vw-1rem)] [-webkit-app-region:no-drag]"
			>
				<div className={`flex items-center ${compactMenuItemClass}`}>
					<HugeiconsIcon
						icon={Globe02Icon}
						className="size-4 text-muted-foreground"
					/>
					<span className="flex-1">
						{message("connections:preview_ports_auto_urls")}
					</span>
					<Switch
						checked={settings.publish}
						disabled={!boxd}
						onCheckedChange={(publish) => update(environmentId, { publish })}
						aria-label={message("connections:preview_ports_auto_urls")}
					/>
				</div>
				<div className={`flex items-center ${compactMenuItemClass}`}>
					<HugeiconsIcon
						icon={ComputerCloudIcon}
						className="size-4 text-muted-foreground"
					/>
					<span className="flex-1">
						{message("connections:preview_ports_local")}
					</span>
					<Switch
						checked={settings.forward}
						disabled={closing || getTunnelsBridge() === undefined}
						onCheckedChange={(enabled) => void toggleForwarding(enabled)}
						aria-label={message("connections:preview_ports_local")}
					/>
				</div>
				<p className="px-2 py-1 text-[11px] text-muted-foreground">
					{message("connections:preview_ports_auto_help")}
				</p>
				<div className="my-1 border-t border-border" />
				<div className="flex h-7 items-center px-2 text-xs text-muted-foreground">
					{message("connections:preview_ports_title")}
				</div>
				<div className="max-h-60 divide-y divide-border overflow-y-auto">
					{previews.map((server) => (
						<div key={server.port}>
							<div className={`flex items-center ${compactMenuItemClass}`}>
								<span
									className={`size-1.5 shrink-0 rounded-full ${server.publicUrl || server.localUrl ? "bg-primary" : "bg-muted-foreground"}`}
								/>
								<span className="font-mono">{server.port}</span>
								<span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
									{server.name}
								</span>
							</div>
							{server.publicUrl ? (
								linkRow(server.publicUrl)
							) : settings.publish && server.publicationState ? (
								<p className="px-6 py-1 text-[11px] text-muted-foreground">
									{message(
										server.publicationState === "failed"
											? "connections:cloud_workspace_menu_preview_failed"
											: "connections:cloud_workspace_menu_preview_pending",
									)}
								</p>
							) : null}
							{server.localUrl ? (
								linkRow(server.localUrl)
							) : settings.forward && server.forwardingState ? (
								<p className="px-6 py-1 text-[11px] text-muted-foreground">
									{message(
										server.forwardingState === "failed"
											? "connections:preview_ports_forward_failed"
											: "connections:preview_ports_forward_pending",
									)}
								</p>
							) : null}
						</div>
					))}
					{previews.length === 0 ? (
						<p className="px-2 py-1 text-xs text-muted-foreground">
							{message("connections:preview_ports_empty")}
						</p>
					) : null}
				</div>
				<form
					className="flex items-center gap-2 px-2 py-2"
					onSubmit={(event) => {
						event.preventDefault();
						if (!validPort) return;
						update(environmentId, {
							ports: [...new Set([...settings.ports, port])].sort(
								(a, b) => a - b,
							),
						});
						setPortText("");
					}}
				>
					<Input
						className="h-7 min-w-0 flex-1 [&_input]:h-full [&_input]:py-0 [&_input]:leading-5"
						inputMode="numeric"
						value={portText}
						onChange={(event) => setPortText(event.target.value)}
						placeholder="3001"
						aria-label={message("connections:preview_ports_number")}
					/>
					<Button
						type="submit"
						className="h-7 gap-1.5 px-2.5 py-0 text-xs leading-5"
						disabled={!validPort}
					>
						<HugeiconsIcon icon={Add01Icon} className="size-3.5" />
						{message("connections:preview_ports_add")}
					</Button>
				</form>
				<p className="px-2 pb-1 text-[11px] text-muted-foreground">
					{message("connections:preview_ports_manual_help")}
				</p>
				<p className="px-2 pb-1 text-[11px] text-muted-foreground">
					{message("connections:preview_ports_public_help")}
				</p>
			</PopoverPopup>
		</Popover>
	);
}
