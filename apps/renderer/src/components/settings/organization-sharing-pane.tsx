import "@zuse/i18n/english/common";
import "@zuse/i18n/english/settings";
import type { ChatSharingDefaults, Organization } from "@zuse/contracts";
import { useMessages } from "@zuse/i18n/react";
import { useEffect, useState } from "react";
import { runCloudControl } from "../../lib/control-plane-client.ts";
import { ChatSharingOptions } from "../chat-sharing-options.tsx";
import { Button } from "../ui/button.tsx";
import { SettingsGroup, SettingsRow } from "../ui/settings-panel.tsx";

export function OrganizationSharingPane({
	organization,
}: {
	readonly organization: Organization;
}) {
	const { message } = useMessages(["common", "settings"]);
	const [saved, setSaved] = useState<ChatSharingDefaults | null>(null);
	const [draft, setDraft] = useState<ChatSharingDefaults | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const [reload, setReload] = useState(0);
	useEffect(() => {
		let active = true;
		setSaved(null);
		setDraft(null);
		setError(false);
		void runCloudControl((client) =>
			client["cloud.sharing.defaults.get"](),
		).then(
			(defaults) => {
				if (active) {
					setSaved(defaults);
					setDraft(defaults);
				}
			},
			() => {
				if (active) setError(true);
			},
		);
		return () => {
			active = false;
		};
	}, [organization.id, reload]);
	const canManage = organization.role === "admin";
	const changed =
		draft !== null &&
		(draft.audience !== saved?.audience ||
			draft.permission !== saved?.permission);
	const save = async () => {
		if (!canManage || draft === null || busy) return;
		setBusy(true);
		setError(false);
		try {
			const defaults = await runCloudControl((client) =>
				client["cloud.sharing.defaults.update"](draft),
			);
			setSaved(defaults);
			setDraft(defaults);
		} catch {
			setError(true);
		} finally {
			setBusy(false);
		}
	};
	return (
		<SettingsGroup title={message("settings:workspace_new_chat_access")}>
			<SettingsRow
				title={message("settings:workspace_sharing_audience")}
				description={message("settings:workspace_new_chat_access_description")}
			>
				{draft === null ? (
					!error && <p>{message("common:loading")}</p>
				) : (
					<div className="flex flex-wrap items-center justify-between gap-3">
						<ChatSharingOptions
							value={draft}
							organizationName={organization.name}
							disabled={!canManage || busy}
							onChange={setDraft}
						/>
						{canManage && (
							<Button
								className="h-7"
								size="xs"
								disabled={!changed || busy}
								onClick={() => void save()}
							>
								{message("common:save")}
							</Button>
						)}
					</div>
				)}
				<p className="text-[11px] leading-4 text-muted-foreground">
					{message("settings:workspace_sharing_admin_notice")}
				</p>
				{error && (
					<div className="flex items-center gap-2">
						<p role="alert">{message("settings:workspace_sharing_error")}</p>
						{draft === null && (
							<Button
								className="h-7"
								size="xs"
								variant="ghost"
								onClick={() => setReload((value) => value + 1)}
							>
								{message("common:retry")}
							</Button>
						)}
					</div>
				)}
			</SettingsRow>
		</SettingsGroup>
	);
}
