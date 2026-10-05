import "@zuse/i18n/english/settings";
import type {
	OrganizationGithubDiscovery,
	OrganizationGithubSettings,
} from "@zuse/contracts";
import { message as uiMessage } from "@zuse/i18n";
import { useMessages } from "@zuse/i18n/react";
import { useCallback, useEffect, useState } from "react";
import {
	type StillCurrent,
	useOrganizationAction,
} from "../../hooks/use-organization-action.ts";
import { runOrganizations } from "../../lib/organization-client.ts";
import { organizationErrorMessage } from "../../lib/organization-error.ts";
import { openExternal } from "../../lib/platform-capabilities.ts";
import { useUiStore } from "../../store/ui.ts";
import { Button } from "../ui/button.tsx";
import { DitherActionButton } from "../ui/dither-action-button.tsx";
import {
	SettingsGroup,
	SettingsNote,
	SettingsRow,
} from "../ui/settings-panel.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { Switch } from "../ui/switch.tsx";
import { OrganizationAvatar } from "./organization-avatar.tsx";

const VERIFICATION_POLL_MS = 2500;
const VERIFICATION_TIMEOUT_MS = 600_000;

// Read-only row state sized like the row's buttons so actions line up.
function StatusChip({
	tone,
	children,
}: {
	tone: "success" | "warning";
	children: string;
}) {
	return (
		<span
			className={
				tone === "success"
					? "inline-flex h-7 items-center rounded-md bg-alert-success-bg px-2.5 text-[11px] font-medium text-success"
					: "inline-flex h-7 items-center rounded-md bg-alert-warning-bg px-2.5 text-[11px] font-medium text-warning"
			}
		>
			{children}
		</span>
	);
}

const discover = () =>
	runOrganizations((c) => c["organizations.githubDiscover"]({}));

/** Lets the signed-in account join organizations through GitHub membership. */
export function OrganizationGithubJoin({
	onJoined,
}: {
	onJoined: (organizationId: string) => Promise<void>;
}) {
	const { message } = useMessages(["settings"]);
	const { busy, error, setError, guard, run } = useOrganizationAction();
	const [discovery, setDiscovery] = useState<
		typeof OrganizationGithubDiscovery.Type | null
	>(null);
	const [waiting, setWaiting] = useState<string | null>(null);
	const [joining, setJoining] = useState<string | null>(null);

	useEffect(() => {
		const current = guard();
		discover()
			.then((result) => {
				if (current()) setDiscovery(result);
			})
			.catch((cause) => {
				if (current()) setError(organizationErrorMessage(cause));
			});
	}, [guard, setError]);

	useEffect(() => {
		if (!waiting) return;
		const current = guard();
		let stopped = false;
		let pending = false;
		const live = () => !stopped && current();
		const poll = async () => {
			if (pending || stopped) return;
			pending = true;
			try {
				const result = await discover();
				if (live() && result.connected && result.verificationId === waiting) {
					setDiscovery(result);
					setWaiting(null);
				}
			} catch (cause) {
				if (live()) {
					setError(organizationErrorMessage(cause));
					setWaiting(null);
				}
			} finally {
				pending = false;
			}
		};
		const interval = window.setInterval(
			() => void poll(),
			VERIFICATION_POLL_MS,
		);
		const timeout = window.setTimeout(() => {
			if (!live()) return;
			setError(uiMessage("settings:organizations_github_timed_out"));
			setWaiting(null);
		}, VERIFICATION_TIMEOUT_MS);
		window.addEventListener("focus", poll);
		return () => {
			stopped = true;
			clearInterval(interval);
			clearTimeout(timeout);
			window.removeEventListener("focus", poll);
		};
	}, [waiting, guard, setError]);

	const verify = () =>
		run(async (current) => {
			let attemptId: string | null = null;
			await openExternal(async () => {
				const auth = await runOrganizations((c) =>
					c["organizations.githubAuthorize"]({}),
				);
				if (!current()) throw new Error("account_changed");
				attemptId = auth.attemptId;
				return auth.url;
			});
			if (current()) setWaiting(attemptId);
		});

	const locked = busy || waiting !== null;
	const connected = discovery?.connected === true;
	const verifyRow = waiting ? (
		<SettingsRow
			title={message("settings:organizations_github_unverified")}
			description={message("settings:organizations_github_waiting_help")}
			action={
				<>
					<span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
						<Spinner className="size-3" />
						{message("settings:organizations_github_waiting")}
					</span>
					<Button
						className="h-7"
						size="default"
						variant="ghost"
						onClick={() => setWaiting(null)}
					>
						{message("settings:organizations_cancel")}
					</Button>
				</>
			}
		/>
	) : connected ? (
		<SettingsRow
			title={message("settings:organizations_github_verified")}
			description={message("settings:organizations_github_verified_help")}
			action={
				<DitherActionButton
					tone="secondary"
					disabled={locked}
					onClick={() => void verify()}
				>
					{message("settings:organizations_github_refresh_identity")}
				</DitherActionButton>
			}
		/>
	) : discovery || error ? (
		<SettingsRow
			title={message("settings:organizations_github_unverified")}
			description={message("settings:organizations_github_find_help")}
			action={
				<DitherActionButton disabled={locked} onClick={() => void verify()}>
					{message("settings:organizations_github_find")}
				</DitherActionButton>
			}
		/>
	) : null;

	return (
		<SettingsGroup
			title={message("settings:organizations_github_joining")}
			action={
				connected ? (
					<Button
						className="h-7"
						size="default"
						variant="ghost"
						disabled={locked}
						onClick={() =>
							void run(async (current) => {
								const result = await discover();
								if (current()) setDiscovery(result);
							})
						}
					>
						{message("settings:organizations_refresh")}
					</Button>
				) : undefined
			}
		>
			{error && <SettingsNote tone="error">{error}</SettingsNote>}
			{!discovery && !error && (
				<SettingsNote>
					<Spinner className="size-3" />
					{message("settings:organizations_github_checking")}
				</SettingsNote>
			)}
			{verifyRow}
			{connected && !waiting && discovery.organizations.length === 0 && (
				<SettingsNote>
					{message("settings:organizations_github_no_matches")}
				</SettingsNote>
			)}
			{!waiting &&
				discovery?.organizations.map((org) => {
					const key = `${org.organizationId}:${org.installationId}`;
					return (
						<SettingsRow
							key={key}
							leading={<OrganizationAvatar seed={org.organizationId} />}
							title={org.name}
							description={message("settings:organizations_github_via", {
								login: org.githubLogin,
							})}
							action={
								org.state === "joined" ? (
									<StatusChip tone="success">
										{message("settings:organizations_github_joined")}
									</StatusChip>
								) : org.state === "full" ? (
									<StatusChip tone="warning">
										{message("settings:organizations_github_full")}
									</StatusChip>
								) : (
									<DitherActionButton
										loading={joining === key}
										disabled={locked}
										onClick={() =>
											void run(async (current) => {
												setJoining(key);
												try {
													await runOrganizations((c) =>
														c["organizations.githubJoin"]({
															organizationId: org.organizationId,
															installationId: org.installationId,
														}),
													);
													if (!current()) return;
													const result = await discover();
													if (!current()) return;
													setDiscovery(result);
													await onJoined(org.organizationId);
												} finally {
													if (current()) setJoining(null);
												}
											})
										}
									>
										{message("settings:organizations_github_join")}
									</DitherActionButton>
								)
							}
						/>
					);
				})}
		</SettingsGroup>
	);
}

/** Admin controls for which GitHub organizations may self-join this organization. */
export function OrganizationGithubAccess({
	organizationId,
}: {
	organizationId: string;
}) {
	const { message } = useMessages(["settings"]);
	const { busy, error, setError, guard, run } = useOrganizationAction();
	const [settings, setSettings] = useState<
		typeof OrganizationGithubSettings.Type | null
	>(null);

	const load = useCallback(
		async (current: StillCurrent) => {
			const result = await runOrganizations((c) =>
				c["organizations.githubSettings"]({ organizationId }),
			);
			if (current()) setSettings(result);
		},
		[organizationId],
	);

	useEffect(() => {
		const current = guard();
		load(current).catch((cause) => {
			if (current()) setError(organizationErrorMessage(cause));
		});
	}, [guard, load, setError]);

	if (!settings && !error) return null;
	return (
		<>
			<SettingsGroup
				title={message("settings:organizations_github_allow")}
				description={message("settings:organizations_github_allow_help")}
			>
				{error && <SettingsNote tone="error">{error}</SettingsNote>}
				{settings?.installations.length === 0 && (
					<SettingsRow
						title={message("settings:organizations_github_not_connected")}
						description={message("settings:organizations_github_connect_help")}
						action={
							<DitherActionButton
								tone="secondary"
								onClick={() =>
									useUiStore
										.getState()
										.setSettingsSection({ kind: "cloud", page: "repositories" })
								}
							>
								{message("settings:workspace_repositories_scripts")}
							</DitherActionButton>
						}
					/>
				)}
				{settings?.installations.map((installation) => (
					<SettingsRow
						key={installation.installationId}
						leading={
							<OrganizationAvatar seed={`github:${installation.login}`} />
						}
						title={installation.login}
						description={message(
							installation.suspended
								? "settings:organizations_github_suspended"
								: "settings:organizations_github_installation",
						)}
						action={
							<Switch
								aria-label={message(
									"settings:organizations_github_allow_installation",
									{ login: installation.login },
								)}
								checked={installation.enabled}
								disabled={busy || installation.suspended}
								onCheckedChange={(enabled) =>
									void run(async (current) => {
										await runOrganizations((c) =>
											c["organizations.githubPolicy"]({
												organizationId,
												installationId: installation.installationId,
												enabled,
											}),
										);
										if (current()) await load(current);
									})
								}
							/>
						}
					/>
				))}
			</SettingsGroup>
			{settings && settings.blockedMembers.length > 0 && (
				<SettingsGroup
					title={message("settings:organizations_github_blocked_title")}
					description={message("settings:organizations_github_blocked")}
				>
					{settings.blockedMembers.map((member) => (
						<SettingsRow
							key={member.accountId}
							leading={<OrganizationAvatar seed={member.accountId} />}
							title={member.displayName}
							action={
								<DitherActionButton
									tone="secondary"
									disabled={busy}
									onClick={() =>
										void run(async (current) => {
											await runOrganizations((c) =>
												c["organizations.githubRestore"]({
													organizationId,
													accountId: member.accountId,
												}),
											);
											if (current()) await load(current);
										})
									}
								>
									{message("settings:organizations_github_restore")}
								</DitherActionButton>
							}
						/>
					))}
				</SettingsGroup>
			)}
		</>
	);
}
