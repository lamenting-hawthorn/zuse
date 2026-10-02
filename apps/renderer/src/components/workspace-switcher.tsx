import "@zuse/i18n/english/settings";
import { useMessages } from "@zuse/i18n/react";
import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "../hooks/use-auth.ts";
import {
	loadOrganizationWorkspaces,
	organizationWorkspacesAvailable,
	useOrganizationWorkspaces,
} from "../lib/organization-workspaces.ts";
import {
	rendererWorkspaceSnapshot,
	selectRendererWorkspace,
	subscribeRendererWorkspace,
} from "../lib/renderer-workspace.ts";
import { requestReviewLeave } from "../lib/review-edit-guard.ts";
import { useUiStore } from "../store/ui.ts";
import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
	SelectValue,
} from "./ui/select.tsx";

export { organizationWorkspacesAvailable } from "../lib/organization-workspaces.ts";

export function WorkspaceSwitcher() {
	const { message } = useMessages(["settings"]);
	const { user } = useAuth();
	const workspace = useSyncExternalStore(
		subscribeRendererWorkspace,
		rendererWorkspaceSnapshot,
	);
	const { organizations, loading, error } = useOrganizationWorkspaces();
	useEffect(() => {
		if (user?.id && organizationWorkspacesAvailable())
			void loadOrganizationWorkspaces().catch(() => undefined);
	}, [user?.id]);
	if (!organizationWorkspacesAvailable() || !user) return null;
	const items = [
		{ value: "personal", label: message("settings:workspace_personal") },
		...organizations.map((organization) => ({
			value: `organization:${organization.id}`,
			label: organization.name,
		})),
		...(!loading &&
		error == null &&
		!organizations.some((organization) => organization.isCreator)
			? [
					{
						value: "create",
						label: message("settings:organizations_create_an_organization"),
					},
				]
			: []),
	];
	return (
		<Select
			items={items}
			value={workspace.key}
			onValueChange={(value) => {
				requestReviewLeave(() => {
					if (value === "create") {
						selectRendererWorkspace({ kind: "personal" });
						useUiStore.getState().setSettingsSection({ kind: "organizations" });
						useUiStore.getState().setView("settings");
						return;
					}
					if (value === "personal")
						selectRendererWorkspace({ kind: "personal" });
					else {
						const organization = organizations.find(
							(entry) => `organization:${entry.id}` === value,
						);
						if (!organization) return;
						selectRendererWorkspace({
							kind: "organization",
							organizationId: organization.id,
						});
						if (organization.role === "billing") {
							useUiStore
								.getState()
								.setSettingsSection({ kind: "cloud", page: "billing" });
							useUiStore.getState().setView("settings");
						}
					}
				});
			}}
		>
			<SelectTrigger
				className="h-7 w-full border-0 bg-transparent shadow-none"
				aria-label={message("settings:workspace_switcher")}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectPopup>
				{items.map((item) => (
					<SelectItem key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
				{loading && (
					<div
						role="status"
						className="px-2 py-1 text-xs text-muted-foreground"
					>
						{message("settings:organizations_loading_organization")}
					</div>
				)}
				{error != null && (
					<button
						type="button"
						className="h-7 px-2 text-xs text-destructive"
						onClick={() =>
							void loadOrganizationWorkspaces(true).catch(() => undefined)
						}
					>
						{message("settings:organizations_refresh")}
					</button>
				)}
			</SelectPopup>
		</Select>
	);
}
