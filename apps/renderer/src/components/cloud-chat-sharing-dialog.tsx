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
import { Check, Globe, Info, Link, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { runCloudControl } from "../lib/control-plane-client.ts";
import { runOrganizations } from "../lib/organization-client.ts";
import { copyText, isHostedProduct } from "../lib/platform-capabilities.ts";
import { subscribeRendererWorkspace } from "../lib/renderer-workspace.ts";
import { ChatSharingOptions, GHOST_TRIGGER } from "./chat-sharing-options.tsx";
import { Avatar, AvatarFallback } from "./ui/avatar.tsx";
import { Button } from "./ui/button.tsx";
import { PopoverDescription, PopoverTitle } from "./ui/popover.tsx";
import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
	SelectValue,
} from "./ui/select.tsx";

const ROW = "flex h-9 items-center gap-2.5";
const AVATAR = "flex size-6 shrink-0 items-center justify-center rounded-full";
const DIVIDER = "my-1.5 h-px bg-border";

export default function CloudChatSharingDialog({
	workspaceId,
	organizationId,
	open,
	onClose,
}: {
	readonly workspaceId: string;
	readonly organizationId: string;
	readonly open: boolean;
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
		if (!open) return;
		const current = ++epoch.current;
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
	}, [workspaceId, organizationId, reload, open]);
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
			setBusy(false);
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
	const loading = state === null && !error;
	const inherited =
		draft?.audience === "organization"
			? message(
					draft.permission === "edit"
						? "settings:workspace_sharing_edit"
						: "settings:workspace_sharing_view",
				)
			: message("settings:sharing_no_access");
	return (
		<div className="flex flex-col p-1 text-xs" aria-busy={busy || loading}>
			<div className="flex h-7 items-center justify-between">
				<PopoverTitle className="text-[13px]">
					{message("settings:sharing_title")}
				</PopoverTitle>
				<PopoverDescription className="sr-only">
					{message("settings:workspace_sharing_admin_notice")}
				</PopoverDescription>
				<Button
					className="-me-1.5 text-muted-foreground hover:text-foreground"
					size="icon"
					variant="ghost"
					title={message("settings:workspace_sharing_admin_notice")}
					aria-label={message("settings:workspace_sharing_admin_notice")}
				>
					<Info className="size-3.5" aria-hidden="true" />
				</Button>
			</div>
			{loading && (
				<p role="status" className="py-6 text-center text-muted-foreground">
					{message("settings:sharing_loading")}
				</p>
			)}
			{draft !== null && organization !== null && state !== null && (
				<>
					<div className="mt-1.5 max-h-56 overflow-y-auto">
						{organization.members
							.filter(
								(member) => member.role === "admin" || member.role === "member",
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
									<div key={member.id} className={ROW}>
										<Avatar className={AVATAR}>
											<AvatarFallback className="rounded-full text-[10px] text-muted-foreground">
												{(member.displayName || member.email)
													.slice(0, 1)
													.toUpperCase()}
											</AvatarFallback>
										</Avatar>
										<div className="min-w-0 flex-1 leading-4">
											<p className="truncate font-medium">
												{member.displayName}
											</p>
											<p className="truncate text-[11px] text-muted-foreground">
												{member.email}
											</p>
										</div>
										{fixedAccess ? (
											<span className="shrink-0 text-muted-foreground">
												{message(
													member.role === "admin"
														? "settings:organizations_admin"
														: "settings:workspace_sharing_edit",
												)}
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
													className={cn(GHOST_TRIGGER, "-me-1.5 max-w-36")}
													aria-label={message("settings:sharing_access_for", {
														name: member.displayName,
													})}
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
					<div className={DIVIDER} />
					<div className={ROW}>
						<span className={cn(AVATAR, "bg-muted text-muted-foreground")}>
							{draft.audience === "organization" ? (
								<Globe className="size-3.5" aria-hidden="true" />
							) : (
								<Lock className="size-3.5" aria-hidden="true" />
							)}
						</span>
						<ChatSharingOptions
							className="flex-1"
							value={draft}
							organizationName={organization.organization.name}
							disabled={busy || !state.canManageSharing}
							onChange={(value) => setDraft({ ...draft, ...value })}
						/>
					</div>
					<div className={DIVIDER} />
					<div className="flex h-7 items-center justify-between gap-2">
						<Button
							className="-ms-2 px-2"
							variant="ghost"
							onClick={() => void copyLink()}
							title={message("settings:sharing_link_notice")}
						>
							{copyState === "copied" ? (
								<Check aria-hidden="true" />
							) : (
								<Link aria-hidden="true" />
							)}
							{message(
								copyState === "copied"
									? "common:copied"
									: "settings:connect_link_card_copy_link",
							)}
						</Button>
						{state.canManageSharing && changed && (
							<Button disabled={busy} onClick={() => void save()}>
								{message("common:save")}
							</Button>
						)}
					</div>
					{copyState === "error" && (
						<p role="alert" className="mt-1 text-destructive">
							{message("settings:sharing_link_copy_failed")}
						</p>
					)}
				</>
			)}
			{error && (
				<div
					role="alert"
					className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted/60 py-1 ps-2.5 pe-1"
				>
					<p className="min-w-0 text-muted-foreground">
						{message("settings:workspace_sharing_error")}
					</p>
					<Button
						className="shrink-0 px-2"
						variant="ghost"
						disabled={busy}
						onClick={() => setReload((value) => value + 1)}
					>
						{message("common:retry")}
					</Button>
				</div>
			)}
		</div>
	);
}
