import "@zuse/i18n/english/common";
import "@zuse/i18n/english/settings";
import type {
	Organization,
	OrganizationDetails,
	OrganizationMember,
	OrganizationRole,
} from "@zuse/contracts";
import { ORGANIZATION_MEMBER_LIMIT } from "@zuse/contracts";
import { message as uiMessage } from "@zuse/i18n";
import { useMessages as useUiMessages } from "@zuse/i18n/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../hooks/use-auth.ts";
import { useOrganizationAction } from "../../hooks/use-organization-action.ts";
import { openOrganizationWorkspace } from "../../lib/open-organization-workspace.ts";
import { runOrganizations } from "../../lib/organization-client.ts";
import { organizationErrorMessage } from "../../lib/organization-error.ts";
import { loadOrganizationWorkspaces } from "../../lib/organization-workspaces.ts";
import { requestReviewLeave } from "../../lib/review-edit-guard.ts";
import {
	AlertDialog,
	AlertDialogClose,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogPopup,
	AlertDialogTitle,
} from "../ui/alert-dialog.tsx";
import { Button } from "../ui/button.tsx";
import { DitherActionButton } from "../ui/dither-action-button.tsx";
import { Input } from "../ui/input.tsx";
import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
	SelectValue,
} from "../ui/select.tsx";
import {
	SettingsFrame,
	SettingsGroup,
	SettingsNote,
	SettingsRow,
} from "../ui/settings-panel.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { OrganizationAvatar } from "./organization-avatar.tsx";
import {
	OrganizationGithubAccess,
	OrganizationGithubJoin,
} from "./organization-github.tsx";

const roleLabel = (role: string) =>
	role === "admin"
		? uiMessage("settings:organizations_admin")
		: role === "member"
			? uiMessage("settings:organizations_member")
			: role === "billing"
				? uiMessage("settings:organizations_billing_only")
				: role;

function OrganizationRoleSelect({
	value,
	disabled,
	label,
	onValueChange,
}: {
	value: string;
	disabled: boolean;
	label: string;
	onValueChange: (role: OrganizationRole) => void;
}) {
	const items = ["member", "admin", "billing"].map((role) => ({
		value: role,
		label: roleLabel(role),
	}));
	if (!items.some((item) => item.value === value))
		items.push({ value, label: value });
	return (
		<Select
			items={items}
			value={value}
			disabled={disabled}
			onValueChange={(next) => {
				if (next === "admin" || next === "member" || next === "billing")
					onValueChange(next);
			}}
		>
			<SelectTrigger className="h-7 w-auto" aria-label={label}>
				<SelectValue />
			</SelectTrigger>
			<SelectPopup>
				{items.map((item) => (
					<SelectItem key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectPopup>
		</Select>
	);
}

/**
 * Organizations settings. Inside an organization workspace this manages that
 * organization only; in personal settings it lists the account's
 * organizations, each managed from its own workspace.
 */
export function OrganizationsPane({
	organizationId,
}: {
	organizationId?: string;
} = {}) {
	useUiMessages(["common", "settings"]);
	const auth = useAuth();
	const currentUserId = auth.user?.id;
	if (!auth.isSignedIn)
		return (
			<SettingsGroup title={uiMessage("settings:organizations_organizations")}>
				<SettingsRow
					title={uiMessage(
						"settings:organizations_sign_in_to_manage_your_team",
					)}
					description={uiMessage(
						"settings:organizations_use_your_zuse_account_to_create_an_organization_or_accept_an_invitation",
					)}
					action={
						<DitherActionButton
							disabled={auth.isLoading || auth.signingIn}
							onClick={() => void auth.signIn()}
						>
							{uiMessage("settings:organizations_sign_in")}
						</DitherActionButton>
					}
				/>
			</SettingsGroup>
		);
	return organizationId === undefined ? (
		<OrganizationDirectory key={currentUserId} />
	) : (
		<OrganizationManagement
			key={`${currentUserId}:${organizationId}`}
			organizationId={organizationId}
		/>
	);
}

/** Account-level view: organizations you belong to and ways to get into one. */
function OrganizationDirectory() {
	const { busy, error, setError, guard, run } = useOrganizationAction();
	const [organizations, setOrganizations] = useState<
		ReadonlyArray<Organization>
	>([]);
	const [loading, setLoading] = useState(true);
	const [name, setName] = useState("");
	const createAttempt = useRef<{ name: string; operationId: string } | null>(
		null,
	);

	const refresh = useCallback(async () => {
		const current = guard();
		setLoading(true);
		setError(null);
		try {
			const list = await loadOrganizationWorkspaces(true);
			if (current()) setOrganizations(list);
		} catch (cause) {
			if (current()) setError(organizationErrorMessage(cause));
		} finally {
			if (current()) setLoading(false);
		}
	}, [guard, setError]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const open = (organization: Organization) =>
		requestReviewLeave(() => openOrganizationWorkspace(organization));

	const canCreate =
		!loading && !error && !organizations.some((org) => org.isCreator);
	return (
		<div className="flex flex-col gap-4 text-xs">
			<SettingsGroup
				title={uiMessage("settings:organizations_your_organizations")}
				action={
					<Button
						className="h-7"
						size="default"
						variant="ghost"
						disabled={busy || loading}
						onClick={() => void refresh()}
					>
						{uiMessage("settings:organizations_refresh")}
					</Button>
				}
			>
				{error && <SettingsNote tone="error">{error}</SettingsNote>}
				{loading && organizations.length === 0 && (
					<SettingsNote>
						<Spinner className="size-3" />
						{uiMessage("settings:organizations_loading_organization")}
					</SettingsNote>
				)}
				{!loading && !error && organizations.length === 0 && (
					<SettingsNote>
						{uiMessage(
							"settings:organizations_no_organizations_yet_create_one_below_or_accept_an_invitation_from_your_team",
						)}
					</SettingsNote>
				)}
				{organizations.map((org) => (
					<SettingsRow
						key={org.id}
						leading={<OrganizationAvatar seed={org.id} />}
						title={org.name}
						description={roleLabel(org.role)}
						action={
							<DitherActionButton
								tone="secondary"
								disabled={busy}
								onClick={() => open(org)}
							>
								{uiMessage("common:open")}
							</DitherActionButton>
						}
					/>
				))}
			</SettingsGroup>
			<OrganizationGithubJoin onJoined={refresh} />
			{canCreate && (
				<SettingsFrame
					title={uiMessage("settings:organizations_create_an_organization")}
					description={uiMessage("settings:organizations_creation_limit")}
				>
					<form
						className="flex items-center gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							if (loading || !name.trim()) return;
							void run(async (current) => {
								const trimmed = name.trim();
								if (createAttempt.current?.name !== trimmed)
									createAttempt.current = {
										name: trimmed,
										operationId: crypto.randomUUID(),
									};
								const attempt = createAttempt.current;
								const created = await runOrganizations((client) =>
									client["organizations.create"](attempt),
								);
								if (!current()) return;
								createAttempt.current = null;
								setName("");
								await refresh();
								// A new organization's next step is inviting people.
								if (current()) open(created);
							});
						}}
					>
						<Input
							className="h-7 min-w-0 flex-1 border-0 shadow-none"
							aria-label={uiMessage("settings:organizations_organization_name")}
							required
							maxLength={100}
							value={name}
							disabled={busy || loading}
							onChange={(event) => setName(event.target.value)}
							placeholder={uiMessage(
								"settings:organizations_organization_name",
							)}
						/>
						<DitherActionButton
							type="submit"
							disabled={busy || loading || !name.trim()}
						>
							{uiMessage("settings:organizations_create")}
						</DitherActionButton>
					</form>
				</SettingsFrame>
			)}
		</div>
	);
}

/** One organization's members, invitations, and GitHub joining policy. */
function OrganizationManagement({
	organizationId,
}: {
	organizationId: string;
}) {
	const { busy, error, setError, guard, run } = useOrganizationAction();
	const [details, setDetails] = useState<OrganizationDetails | null>(null);
	const [loading, setLoading] = useState(true);
	const [notice, setNotice] = useState<string | null>(null);
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<OrganizationRole>("member");
	const [removing, setRemoving] = useState<OrganizationMember | null>(null);

	const refresh = useCallback(async () => {
		const current = guard();
		setLoading(true);
		setError(null);
		try {
			const next = await runOrganizations((client) =>
				client["organizations.get"]({ organizationId }),
			);
			if (current()) setDetails(next);
		} catch (cause) {
			if (current()) setError(organizationErrorMessage(cause));
		} finally {
			if (current()) setLoading(false);
		}
	}, [organizationId, guard, setError]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const mutate = (
		operation: (current: () => boolean) => Promise<void>,
	): Promise<void> => {
		setNotice(null);
		return run(operation);
	};

	const admin = details?.organization.role === "admin";
	const seatsFull =
		details !== null &&
		details.members.length + details.invitations.length >=
			ORGANIZATION_MEMBER_LIMIT;
	const refreshAction = (
		<Button
			className="h-7"
			size="default"
			variant="ghost"
			disabled={busy || loading}
			onClick={() => void refresh()}
		>
			{uiMessage("settings:organizations_refresh")}
		</Button>
	);
	return (
		<div className="flex flex-col gap-4 text-xs">
			{notice && (
				<p role="status" className="text-muted-foreground">
					{notice}
				</p>
			)}
			{error && (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			)}
			{loading && (
				<p role="status" className="text-muted-foreground">
					{uiMessage("settings:organizations_loading_organization")}
				</p>
			)}
			{!details && <div className="flex justify-end">{refreshAction}</div>}
			{details && (
				<SettingsGroup
					title={uiMessage("settings:organizations_members")}
					action={refreshAction}
				>
					{details.members.map((member) => (
						<SettingsRow
							key={member.id}
							leading={<OrganizationAvatar seed={member.userId} />}
							title={
								member.userId === details.currentUserId
									? uiMessage("settings:organizations_current_member", {
											name: member.displayName,
										})
									: member.displayName
							}
							description={
								member.githubManaged
									? `${member.email} · ${uiMessage("settings:organizations_github_managed")}`
									: member.email
							}
							action={
								<div className="flex items-center gap-2">
									{admin &&
									member.userId !== details.currentUserId &&
									!member.directoryManaged ? (
										<>
											{member.githubManaged ? (
												<span className="text-muted-foreground">
													{roleLabel(member.role)}
												</span>
											) : (
												<OrganizationRoleSelect
													label={uiMessage("settings:organizations_role_for", {
														email: member.email,
													})}
													value={member.role}
													disabled={busy || loading}
													onValueChange={(nextRole) => {
														void mutate(async (current) => {
															await runOrganizations((client) =>
																client["organizations.setRole"]({
																	organizationId,
																	memberId: member.id,
																	role: nextRole,
																}),
															);
															if (current()) await refresh();
														});
													}}
												/>
											)}
											<Button
												className="h-7"
												size="default"
												variant="ghost"
												disabled={busy || loading}
												onClick={() => setRemoving(member)}
											>
												{uiMessage("settings:organizations_remove")}
											</Button>
										</>
									) : (
										<span className="text-muted-foreground">
											{member.directoryManaged
												? uiMessage("settings:organizations_directory_managed")
												: roleLabel(member.role)}
										</span>
									)}
								</div>
							}
						/>
					))}
				</SettingsGroup>
			)}
			{admin && (
				<SettingsGroup
					title={uiMessage("settings:organizations_invite_people")}
					description={uiMessage("settings:organizations_member_limit", {
						limit: ORGANIZATION_MEMBER_LIMIT,
					})}
				>
					<form
						className="flex flex-wrap items-center gap-2 px-3 py-2.5"
						onSubmit={(event) => {
							event.preventDefault();
							void mutate(async (current) => {
								await runOrganizations((client) =>
									client["organizations.invite"]({
										organizationId,
										email: email.trim(),
										role,
									}),
								);
								if (!current()) return;
								setEmail("");
								await refresh();
								if (current())
									setNotice(
										uiMessage("settings:organizations_invitation_sent"),
									);
							});
						}}
					>
						<Input
							className="h-7 min-w-40 flex-1"
							aria-label={uiMessage("settings:organizations_invitation_email")}
							type="email"
							required
							maxLength={254}
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							disabled={busy || loading}
							placeholder={uiMessage("settings:organizations_name_company_com")}
						/>
						<OrganizationRoleSelect
							label={uiMessage("settings:organizations_invitation_role")}
							value={role}
							disabled={busy || loading}
							onValueChange={setRole}
						/>
						<DitherActionButton
							type="submit"
							disabled={busy || loading || seatsFull || !email.trim()}
						>
							{uiMessage("settings:organizations_send_invitation")}
						</DitherActionButton>
					</form>
					{details?.invitations.map((invite) => (
						<SettingsRow
							key={invite.id}
							leading={<OrganizationAvatar seed={invite.email} />}
							title={invite.email}
							description={uiMessage(
								"settings:organizations_invitation_pending",
							)}
							action={
								<Button
									className="h-7"
									size="default"
									variant="ghost"
									disabled={busy || loading}
									onClick={() =>
										void mutate(async (current) => {
											await runOrganizations((client) =>
												client["organizations.revokeInvite"]({
													organizationId,
													invitationId: invite.id,
												}),
											);
											if (current()) await refresh();
										})
									}
								>
									{uiMessage("settings:organizations_revoke")}
								</Button>
							}
						/>
					))}
				</SettingsGroup>
			)}
			{admin && <OrganizationGithubAccess organizationId={organizationId} />}
			<AlertDialog
				open={removing !== null}
				onOpenChange={(open) => {
					if (!open && !busy) setRemoving(null);
				}}
			>
				<AlertDialogPopup>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{uiMessage("settings:organizations_remove_member")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{uiMessage("settings:organizations_remove_description", {
								email: removing?.email ?? "",
							})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogClose
							render={
								<Button
									className="h-7"
									size="default"
									variant="ghost"
									disabled={busy}
								/>
							}
						>
							{uiMessage("settings:organizations_cancel")}
						</AlertDialogClose>
						<DitherActionButton
							disabled={busy}
							onClick={() => {
								if (!removing) return;
								const memberId = removing.id;
								void mutate(async (current) => {
									await runOrganizations((client) =>
										client["organizations.removeMember"]({
											organizationId,
											memberId,
										}),
									);
									if (!current()) return;
									setRemoving(null);
									await refresh();
								});
							}}
						>
							{uiMessage("settings:organizations_remove_member")}
						</DitherActionButton>
					</AlertDialogFooter>
				</AlertDialogPopup>
			</AlertDialog>
		</div>
	);
}
