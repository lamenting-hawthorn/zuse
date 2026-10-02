import "@zuse/i18n/english/settings";
import { useMessages } from "@zuse/i18n/react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText, openExternal } from "~/lib/platform-capabilities.ts";
import { Button } from "../ui/button.tsx";
import { COMPACT_CLOUD_ACTION } from "./cloud-settings-ui.tsx";
export function CopyAction({
	text,
	label,
	compact = false,
}: {
	readonly text: string;
	readonly label: string;
	readonly compact?: boolean;
}) {
	const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
		"idle",
	);

	useEffect(() => {
		if (copyState === "idle") return;
		const timer = window.setTimeout(() => setCopyState("idle"), 1_500);
		return () => window.clearTimeout(timer);
	}, [copyState]);
	const buttonLabel =
		copyState === "copied"
			? "Copied"
			: copyState === "error"
				? "Copy failed"
				: label;

	return (
		<Button
			className={COMPACT_CLOUD_ACTION}
			size={compact ? "icon-xs" : "sm"}
			variant="ghost"
			aria-label={buttonLabel}
			onClick={() => {
				void copyText(text).then(
					() => setCopyState("copied"),
					() => setCopyState("error"),
				);
			}}
		>
			{copyState === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
			{compact ? null : buttonLabel}
		</Button>
	);
}

export function DeviceLoginSteps({ code, url }: { code: string; url: string }) {
	const { message: t } = useMessages(["settings"]);
	return (
		<div className="space-y-4">
			<div className="space-y-1.5">
				<p className="text-xs">
					1. {t("settings:model_connections_copy_code")}
				</p>
				<div className="flex h-7 w-fit items-center gap-2 rounded-md bg-muted/60 pl-2.5">
					<code className="select-all text-sm tracking-wider">{code}</code>
					<CopyAction
						compact
						text={code}
						label={t("settings:model_connections_copy_code")}
					/>
				</div>
			</div>
			<div className="space-y-1.5">
				<p className="text-xs">2. {t("settings:model_connections_verify")}</p>
				<div className="flex items-center gap-1.5">
					<Button
						className="h-7"
						size="sm"
						variant="settings"
						onClick={() => void openExternal(url)}
					>
						<ExternalLink aria-hidden />
						{t("settings:model_connections_verification_page")}
					</Button>
					<CopyAction
						text={url}
						label={t("settings:model_connections_copy_link")}
					/>
				</div>
			</div>
			<p className="text-[11px] text-muted-foreground">
				{t("settings:model_connections_login_notice")}
			</p>
		</div>
	);
}
