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
import { runOrganizations } from "../../lib/organization-client.ts";
import { loadOrganizationWorkspaces } from "../../lib/organization-workspaces.ts";
import { rendererAccountSnapshot } from "../../lib/renderer-account.ts";
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
	SettingsRow,
} from "../ui/settings-panel.tsx";

export const organizationErrorMessage = (error: unknown): string => {
	const code =
		error !== null && typeof error === "object" && "code" in error
			? error.code
			: null;
	if (code === "not-allowed")
		return uiMessage("settings:organizations_access_changed");
	if (code === "organization-limit-reached")
		return uiMessage("settings:organizations_creation_limit");
	if (code === "organization-member-limit-reached")
		return uiMessage("settings:organizations_member_limit", {
			limit: ORGANIZATION_MEMBER_LIMIT,
		});
	if (code === "conflict") return uiMessage("settings:organizations_conflict");
	if (code === "invalid-request")
		return uiMessage("settings:organizations_invalid");
	if (code === "not-found")
		return uiMessage("settings:organizations_not_found");
	return uiMessage("settings:organizations_unavailable");
};

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
	const items = [
		{ value: "member", label: uiMessage("settings:organizations_member") },
		{ value: "admin", label: uiMessage("settings:organizations_admin") },
		{
			value: "billing",
			label: uiMessage("settings:organizations_billing_only"),
		},
	];
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

export function OrganizationsPane({
	organizationId,
}: {
	organizationId?: string;
} = {}) {
	useUiMessages(["settings"]);
	const auth = useAuth();
	const [organizations, setOrganizations] = useState<
		ReadonlyArray<Organization>
	>([]);
	const [selectedId, setSelectedId] = useState("");
	const [details, setDetails] = useState<OrganizationDetails | null>(null);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<OrganizationRole>("member");
	const [loading, setLoading] = useState(true);
	const [listReady, setListReady] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [removing, setRemoving] = useState<OrganizationMember | null>(null);
	const generation = useRef(0);
	const mutationInFlight = useRef<object | null>(null);
	const accountGeneration = useRef(0);
	const createAttempt = useRef<{ name: string; operationId: string } | null>(
		null,
	);
	const currentUserId = auth.user?.id;

	const refresh = useCallback(
		async (preferId?: string) => {
			const epoch = ++generation.current;
			const account = rendererAccountSnapshot();
			const stillCurrent = () =>
				epoch === generation.current && account === rendererAccountSnapshot();
			setLoading(true);
			setListReady(false);
			setError(null);
			setDetails(null);
			try {
				const list = await loadOrganizationWorkspaces(true);
				if (!stillCurrent()) return;
				setOrganizations(list);
				setListReady(true);
				const id =
					organizationId ??
					list.find((org) => org.id === preferId)?.id ??
					list[0]?.id ??
					"";
				setSelectedId(id);
				if (id) {
					const next = await runOrganizations((client) =>
						client["organizations.get"]({ organizationId: id }),
					);
					if (stillCurrent()) setDetails(next);
				}
			} catch (cause) {
				if (stillCurrent()) setError(organizationErrorMessage(cause));
			} finally {
				if (stillCurrent()) setLoading(false);
			}
		},
		[organizationId],
	);

	useEffect(() => {
		setBusy(false);
		mutationInFlight.current = null;
		setOrganizations([]);
		setListReady(false);
		setSelectedId("");
		setDetails(null);
		setError(null);
		setNotice(null);
		setEmail("");
		setName("");
		setRemoving(null);
		createAttempt.current = null;
		if (currentUserId) void refresh();
		else setLoading(false);
		return () => {
			generation.current++;
			accountGeneration.current++;
		};
	}, [currentUserId, refresh]);

	const mutate = async (
		operation: (stillCurrent: () => boolean) => Promise<void>,
	) => {
		if (mutationInFlight.current !== null) return;
		const marker = {};
		mutationInFlight.current = marker;
		const epoch = accountGeneration.current;
		const account = rendererAccountSnapshot();
		const stillCurrent = () =>
			epoch === accountGeneration.current &&
			account === rendererAccountSnapshot();
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await operation(stillCurrent);
		} catch (cause) {
			if (stillCurrent()) setError(organizationErrorMessage(cause));
		} finally {
			if (mutationInFlight.current === marker) mutationInFlight.current = null;
			if (stillCurrent()) setBusy(false);
		}
	};

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
						<Button
							className="h-7"
							size="xs"
							disabled={auth.isLoading || auth.signingIn}
							onClick={() => void auth.signIn()}
						>
							{uiMessage("settings:organizations_sign_in")}
						</Button>
					}
				/>
			</SettingsGroup>
		);
	const admin = details?.organization.role === "admin";
	const seatsFull =
		details !== null &&
		details.members.length + details.invitations.length >=
			ORGANIZATION_MEMBER_LIMIT;
	const refreshAction = (
		<Button
			className="h-7"
			size="xs"
			variant="ghost"
			disabled={busy || loading}
			onClick={() => void refresh(selectedId)}
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
			{organizationId !== undefined && !details && (
				<div className="flex justify-end">{refreshAction}</div>
			)}
			{organizationId === undefined && (
				<SettingsFrame
					title={uiMessage("settings:organizations_your_organizations")}
					action={refreshAction}
				>
					{!loading && organizations.length === 0 && !error && (
						<p className="text-muted-foreground">
							{uiMessage(
								"settings:organizations_no_organizations_yet_create_one_below_or_accept_an_invitation_from_your_team",
							)}
						</p>
					)}
					<div className="flex items-center gap-2">
						{organizationId === undefined && organizations.length > 0 && (
							<Select
								items={organizations.map((org) => ({
									value: org.id,
									label: org.name,
								}))}
								value={selectedId}
								disabled={busy || loading}
								onValueChange={(value) => {
									if (!value) return;
									setEmail("");
									setNotice(null);
									void refresh(value);
								}}
							>
								<SelectTrigger
									className="h-7 min-w-0 flex-1"
									aria-label={uiMessage("settings:organizations_organization")}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectPopup>
									{organizations.map((org) => (
										<SelectItem key={org.id} value={org.id}>
											{org.name}
										</SelectItem>
									))}
								</SelectPopup>
							</Select>
						)}
					</div>
				</SettingsFrame>
			)}
			{details && (
				<SettingsGroup
					title={uiMessage("settings:organizations_members")}
					action={organizationId === undefined ? undefined : refreshAction}
				>
					{details.members.map((member) => (
						<SettingsRow
							key={member.id}
							title={
								member.userId === details.currentUserId
									? uiMessage("settings:organizations_current_member", {
											name: member.displayName,
										})
									: member.displayName
							}
							description={member.email}
							action={
								<div className="flex items-center gap-2">
									{admin &&
									member.userId !== details.currentUserId &&
									!member.directoryManaged ? (
										<>
											<OrganizationRoleSelect
												label={uiMessage("settings:organizations_role_for", {
													email: member.email,
												})}
												value={member.role}
												disabled={busy || loading}
												onValueChange={(nextRole) => {
													void mutate(async (stillCurrent) => {
														await runOrganizations((client) =>
															client["organizations.setRole"]({
																organizationId: selectedId,
																memberId: member.id,
																role: nextRole,
															}),
														);
														if (stillCurrent()) await refresh(selectedId);
													});
												}}
											/>
											<Button
												className="h-7"
												size="xs"
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
												: member.role === "admin"
													? uiMessage("settings:organizations_admin")
													: member.role === "member"
														? uiMessage("settings:organizations_member")
														: member.role}
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
							void mutate(async (stillCurrent) => {
								await runOrganizations((client) =>
									client["organizations.invite"]({
										organizationId: selectedId,
										email: email.trim(),
										role,
									}),
								);
								if (!stillCurrent()) return;
								setEmail("");
								await refresh(selectedId);
								if (stillCurrent())
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
						<Button
							className="h-7"
							size="xs"
							type="submit"
							disabled={busy || loading || seatsFull || !email.trim()}
						>
							{uiMessage("settings:organizations_send_invitation")}
						</Button>
					</form>
					{details?.invitations.map((invite) => (
						<SettingsRow
							key={invite.id}
							title={invite.email}
							description={uiMessage(
								"settings:organizations_invitation_pending",
							)}
							action={
								<Button
									className="h-7"
									size="xs"
									variant="ghost"
									disabled={busy || loading}
									onClick={() =>
										void mutate(async (stillCurrent) => {
											await runOrganizations((client) =>
												client["organizations.revokeInvite"]({
													organizationId: selectedId,
													invitationId: invite.id,
												}),
											);
											if (stillCurrent()) await refresh(selectedId);
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
			{organizationId === undefined &&
				listReady &&
				!organizations.some((organization) => organization.isCreator) && (
					<SettingsFrame
						title={uiMessage("settings:organizations_create_an_organization")}
						description={uiMessage("settings:organizations_creation_limit")}
					>
						<form
							className="flex items-center gap-2"
							onSubmit={(event) => {
								event.preventDefault();
								if (!listReady || loading || !name.trim()) return;
								void mutate(async (stillCurrent) => {
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
									if (!stillCurrent()) return;
									createAttempt.current = null;
									setName("");
									await refresh(created.id);
								});
							}}
						>
							<Input
								className="h-7 min-w-0 flex-1 border-0 shadow-none"
								aria-label={uiMessage(
									"settings:organizations_organization_name",
								)}
								required
								maxLength={100}
								value={name}
								disabled={busy || loading}
								onChange={(event) => setName(event.target.value)}
								placeholder={uiMessage(
									"settings:organizations_organization_name",
								)}
							/>
							<Button
								className="h-7"
								size="xs"
								type="submit"
								disabled={busy || loading || !name.trim()}
							>
								{uiMessage("settings:organizations_create")}
							</Button>
						</form>
					</SettingsFrame>
				)}
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
									size="xs"
									variant="ghost"
									disabled={busy}
								/>
							}
						>
							{uiMessage("settings:organizations_cancel")}
						</AlertDialogClose>
						<Button
							className="h-7"
							size="xs"
							disabled={busy}
							onClick={() => {
								if (!removing) return;
								const memberId = removing.id;
								void mutate(async (stillCurrent) => {
									await runOrganizations((client) =>
										client["organizations.removeMember"]({
											organizationId: selectedId,
											memberId,
										}),
									);
									if (!stillCurrent()) return;
									setRemoving(null);
									await refresh(selectedId);
								});
							}}
						>
							{uiMessage("settings:organizations_remove_member")}
						</Button>
					</AlertDialogFooter>
				</AlertDialogPopup>
			</AlertDialog>
		</div>
	);
}
