import "@zuse/i18n/english/common";
import "@zuse/i18n/english/settings";
import { cloudChatRoute } from "@zuse/client-runtime/environment-scope";
import type {
	ChatSharingPolicy,
	ChatSharingState,
	OrganizationDetails,
} from "@zuse/contracts";
import { HOSTED_APP_URL } from "@zuse/contracts/deployment";
import { useMessages } from "@zuse/i18n/react";
import { useEffect, useRef, useState } from "react";
import { runCloudControl } from "../lib/control-plane-client.ts";
import { runOrganizations } from "../lib/organization-client.ts";
import { copyText, isHostedProduct } from "../lib/platform-capabilities.ts";
import { subscribeRendererWorkspace } from "../lib/renderer-workspace.ts";
import { ChatSharingOptions } from "./chat-sharing-options.tsx";
import { Button } from "./ui/button.tsx";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogPopup,
	DialogTitle,
} from "./ui/dialog.tsx";
import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
	SelectValue,
} from "./ui/select.tsx";

export default function CloudChatSharingDialog({
	workspaceId,
	organizationId,
	onClose,
}: {
	readonly workspaceId: string;
	readonly organizationId: string;
	readonly onClose: () => void;
}) {
	const { message } = useMessages(["common", "settings"]);
	const [state, setState] = useState<ChatSharingState | null>(null);
	const [organization, setOrganization] = useState<OrganizationDetails | null>(
		null,
	);
	const [draft, setDraft] = useState<ChatSharingPolicy | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const [reload, setReload] = useState(0);
	const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
		"idle",
	);
	const epoch = useRef(0);
	useEffect(() => subscribeRendererWorkspace(onClose), [onClose]);
	useEffect(() => {
		const current = ++epoch.current;
		setState(null);
		setDraft(null);
		setOrganization(null);
		setError(false);
		setCopyState("idle");
		void Promise.all([
			runCloudControl((client) => client["cloud.sharing.get"]({ workspaceId })),
			runOrganizations((client) =>
				client["organizations.get"]({ organizationId }),
			),
		]).then(
			([sharing, details]) => {
				if (current !== epoch.current) return;
				setState(sharing);
				setDraft(sharing.policy);
				setOrganization(details);
			},
			() => {
				if (current === epoch.current) setError(true);
			},
		);
		return () => {
			epoch.current++;
		};
	}, [workspaceId, organizationId, reload]);
	const save = async () => {
		if (
			!state?.canManageSharing ||
			draft === null ||
			organization === null ||
			busy
		)
			return;
		const current = epoch.current;
		setBusy(true);
		setError(false);
		try {
			const updated = await runCloudControl((client) =>
				client["cloud.sharing.update"]({
					workspaceId,
					expectedRevision: state.revision,
					audience: draft.audience,
					permission: draft.permission,
					grants: draft.grants.filter((grant) =>
						organization.members.some(
							(member) =>
								member.id === grant.membershipId &&
								(member.role === "admin" || member.role === "member"),
						),
					),
				}),
			);
			if (current === epoch.current) {
				setState(updated);
				setDraft(updated.policy);
			}
		} catch {
			if (current === epoch.current) setError(true);
		} finally {
			if (current === epoch.current) setBusy(false);
		}
	};
	const changed =
		draft !== null && JSON.stringify(draft) !== JSON.stringify(state?.policy);
	const copyLink = async () => {
		const current = epoch.current;
		try {
			await copyText(
				`${isHostedProduct() ? window.location.origin : HOSTED_APP_URL}${cloudChatRoute(
					{
						scope: { kind: "organization", organizationId },
						workspaceId,
					},
				)}`,
			);
			if (current === epoch.current) setCopyState("copied");
		} catch {
			if (current === epoch.current) setCopyState("error");
		}
	};
	const inherited =
		draft?.audience === "organization"
			? message(
					draft.permission === "edit"
						? "settings:workspace_sharing_edit"
						: "settings:workspace_sharing_view",
				)
			: message("settings:sharing_no_access");
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogPopup className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{message("settings:sharing_title")}</DialogTitle>
					<DialogDescription>
						{message("settings:workspace_sharing_admin_notice")}
					</DialogDescription>
				</DialogHeader>
				<div
					className="space-y-3 px-5 pb-5 text-xs"
					aria-busy={busy || (state === null && !error)}
				>
					{state === null && !error && (
						<p role="status">{message("settings:sharing_loading")}</p>
					)}
					{draft !== null && organization !== null && state !== null && (
						<>
							<ChatSharingOptions
								value={draft}
								organizationName={organization.organization.name}
								disabled={busy || !state.canManageSharing}
								onChange={(value) => setDraft({ ...draft, ...value })}
							/>
							<div className="max-h-64 space-y-2 overflow-y-auto">
								{organization.members
									.filter(
										(member) =>
											member.role === "admin" || member.role === "member",
									)
									.map((member) => {
										const fixedAccess =
											member.role === "admin" ||
											(draft.audience === "organization" &&
												draft.permission === "edit") ||
											(member.id === draft.creatorMembershipId &&
												member.userId === draft.creatorSubject);
										const grant = draft.grants.find(
											(entry) => entry.membershipId === member.id,
										);
										const options = [
											{
												value: "inherit",
												label: message("settings:workspace_sharing_inherited", {
													permission: inherited,
												}),
											},
											{
												value: "view",
												label: message("settings:workspace_sharing_view"),
											},
											{
												value: "edit",
												label: message("settings:workspace_sharing_edit"),
											},
										];
										return (
											<div key={member.id} className="flex items-center gap-2">
												<div className="min-w-0 flex-1">
													<p className="truncate">{member.displayName}</p>
													<p className="truncate text-muted-foreground">
														{member.email}
													</p>
												</div>
												{fixedAccess ? (
													<span className="text-muted-foreground">
														{message("settings:workspace_sharing_edit")}
													</span>
												) : (
													<Select
														items={options}
														value={grant?.permission ?? "inherit"}
														disabled={busy || !state.canManageSharing}
														onValueChange={(permission) => {
															if (
																permission !== "view" &&
																permission !== "edit" &&
																permission !== "inherit"
															)
																return;
															const grants = draft.grants.filter(
																(entry) => entry.membershipId !== member.id,
															);
															if (permission !== "inherit") {
																grants.push({
																	membershipId: member.id,
																	permission,
																});
															}
															setDraft({ ...draft, grants });
														}}
													>
														<SelectTrigger
															className="h-7 w-auto max-w-40"
															aria-label={message(
																"settings:sharing_access_for",
																{ name: member.displayName },
															)}
														>
															<SelectValue />
														</SelectTrigger>
														<SelectPopup>
															{options.map((item) => (
																<SelectItem key={item.value} value={item.value}>
																	{item.label}
																</SelectItem>
															))}
														</SelectPopup>
													</Select>
												)}
											</div>
										);
									})}
							</div>
							<p className="text-muted-foreground">
								{message("settings:sharing_link_notice")}
							</p>
							<div className="flex items-center justify-between gap-2">
								<Button
									className="h-7"
									size="xs"
									variant="ghost"
									onClick={() => void copyLink()}
								>
									{message(
										copyState === "copied"
											? "common:copied"
											: "settings:connect_link_card_copy_link",
									)}
								</Button>
								{state.canManageSharing && (
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
							{copyState === "error" && (
								<p role="alert">
									{message("settings:sharing_link_copy_failed")}
								</p>
							)}
						</>
					)}
					{error && (
						<div role="alert" className="space-y-2">
							<p>{message("settings:workspace_sharing_error")}</p>
							<Button
								className="h-7"
								size="xs"
								variant="ghost"
								disabled={busy}
								onClick={() => setReload((value) => value + 1)}
							>
								{message("common:retry")}
							</Button>
						</div>
					)}
				</div>
			</DialogPopup>
		</Dialog>
	);
}
