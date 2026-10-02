import { CopyButton } from "../copy-button.tsx";
import "@zuse/i18n/english/settings";
import { useMessages } from "@zuse/i18n/react";
import { ExternalLink } from "lucide-react";
import { openExternal } from "~/lib/platform-capabilities.ts";
import { Button } from "../ui/button.tsx";
export function CopyAction({
	text,
	label,
	compact = false,
}: {
	readonly text: string;
	readonly label: string;
	readonly compact?: boolean;
}) {
	return (
		<CopyButton
			text={text}
			label={label}
			showLabel={!compact}
			className={compact ? "h-7 w-7" : "h-7"}
		/>
	);
}
export function DeviceCode({
	code,
	label,
}: {
	readonly code: string;
	readonly label: string;
}) {
	return (
		<div className="flex h-7 w-fit items-center gap-2 rounded-md bg-muted/60 pl-2.5">
			<code className="select-all text-sm tracking-wider">{code}</code>
			<CopyAction compact text={code} label={label} />
		</div>
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
				<DeviceCode
					code={code}
					label={t("settings:model_connections_copy_code")}
				/>
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
