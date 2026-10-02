import { useSettingsStore } from "~/lib/settings-client-bus.ts";
import { useAuth } from "../../hooks/use-auth.ts";
import { Switch } from "../ui/switch.tsx";
import "@zuse/i18n/english/settings";
import type { ModelConnection } from "@zuse/contracts";
import { useMessages } from "@zuse/i18n/react";
import { MoreHorizontal, Plus, RefreshCw, Star } from "lucide-react";
import { useRef, useState } from "react";
import { useModelConnections } from "~/lib/use-model-connections.ts";
import { openExternal } from "~/lib/use-provider-login.ts";
import { BlurredEmail } from "../blurred-email.tsx";
import { ProviderIcon } from "../provider-icons.tsx";
import { Button } from "../ui/button.tsx";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPanel,
	DialogPopup,
	DialogTitle,
} from "../ui/dialog.tsx";
import { Input } from "../ui/input.tsx";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu.tsx";
import { SettingsGroup } from "../ui/settings-panel.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { DeviceLoginSteps } from "./connection-login-steps.tsx";

// Provider product names are not translated.
const connectionNames = { chatgpt: "ChatGPT", supergrok: "SuperGrok" };

function ConnectionRow({
	connection,
	busy,
	onRename,
	onPreferred,
	onReconnect,
	onDisconnect,
}: {
	connection: ModelConnection;
	busy: boolean;
	onRename: (name: string) => Promise<boolean>;
	onPreferred: () => void;
	onReconnect: () => void;
	onDisconnect: () => void;
}) {
	const { message: t } = useMessages(["common", "settings"]);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(connection.name);
	const provider = connection.provider === "supergrok" ? "grok" : "codex";
	const providerName = connectionNames[connection.provider ?? "chatgpt"];
	return (
		<div className="px-3 py-2">
			<div className="flex min-w-0 items-center gap-2.5">
				<div className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/60">
					<ProviderIcon providerId={provider} className="size-4" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<p className="truncate text-xs font-medium">
							{connection.name === connection.email
								? providerName
								: connection.name}
						</p>
						{connection.preferred && (
							<Star
								className="size-3 shrink-0 text-muted-foreground"
								aria-label={t("settings:chatgpt_preferred")}
							/>
						)}
					</div>
					<div
						title={connection.clientId}
						className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"
					>
						{connection.email !== undefined && (
							<>
								<BlurredEmail email={connection.email} />
								<span aria-hidden>·</span>
							</>
						)}
						<span className="truncate">
							{[
								connection.storage === "account"
									? t("settings:model_connections_account_scope")
									: t("settings:model_connections_local_scope"),
								connection.status === "connected"
									? null
									: connection.status === "permission-required"
										? t("settings:chatgpt_permission_required")
										: connection.status === "pending"
											? t("settings:chatgpt_pending")
											: t("settings:chatgpt_disconnected"),
							]
								.filter((part) => part !== null)
								.join(" · ")}
						</span>
					</div>
				</div>
				<Menu>
					<MenuTrigger
						render={
							<Button
								className="h-7 w-7"
								size="icon-sm"
								variant="ghost"
								disabled={busy || editing}
								aria-label={t("settings:model_connections_actions")}
							/>
						}
					>
						<MoreHorizontal className="size-4" />
					</MenuTrigger>
					<MenuPopup align="end">
						<MenuItem
							className="h-7"
							disabled={connection.status === "pending"}
							onClick={() => {
								setName(connection.name);
								setEditing(true);
							}}
						>
							{t("settings:chatgpt_rename")}
						</MenuItem>
						<MenuItem
							className="h-7"
							disabled={!connection.authorized || connection.preferred}
							onClick={onPreferred}
						>
							{t("settings:chatgpt_make_preferred")}
						</MenuItem>
						<MenuItem className="h-7" onClick={onReconnect}>
							{t("settings:chatgpt_reconnect")}
						</MenuItem>
						<MenuItem
							className="h-7"
							onClick={() =>
								openExternal(
									provider === "grok"
										? "https://grok.com"
										: "https://chatgpt.com/settings/usage",
								)
							}
						>
							{t("settings:chatgpt_manage_usage")}
						</MenuItem>
						{connection.status !== "pending" &&
							connection.status !== "disconnected" && (
								<MenuItem className="h-7" onClick={onDisconnect}>
									{t("common:disconnect")}
								</MenuItem>
							)}
					</MenuPopup>
				</Menu>
			</div>
			{editing && (
				<form
					className="mt-2 flex items-center gap-1.5"
					onSubmit={(event) => {
						event.preventDefault();
						void onRename(name).then((ok) => {
							if (ok) setEditing(false);
						});
					}}
				>
					<Input
						className="h-7"
						value={name}
						onChange={(event) => setName(event.target.value)}
						maxLength={200}
						aria-label={t("settings:chatgpt_account_name")}
						disabled={busy}
						autoFocus
					/>
					<Button
						className="h-7"
						size="sm"
						type="submit"
						disabled={busy || !name.trim()}
					>
						{t("common:save")}
					</Button>
					<Button
						className="h-7"
						size="sm"
						variant="ghost"
						type="button"
						disabled={busy}
						onClick={() => setEditing(false)}
					>
						{t("common:cancel")}
					</Button>
				</form>
			)}
		</div>
	);
}
function LocalConnections({ environmentId }: { environmentId: string }) {
	const enabled = useSettingsStore((s) => s.providerEnabled.zuse === true);
	const setProviderEnabled = useSettingsStore((s) => s.setProviderEnabled);
	const { message: t } = useMessages(["common", "settings"]);
	return (
		<SettingsGroup title={t("settings:chatgpt_experimental")}>
			<div className="flex min-h-12 items-center gap-3 px-3 py-2">
				<span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/60">
					<ProviderIcon providerId="zuse" className="size-5" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-xs font-medium text-foreground">
						{t("settings:zuse_harness_enable")}
					</p>
					<p className="text-[11px] text-muted-foreground">
						{t("settings:zuse_harness_description")}
					</p>
				</div>
				<Switch
					checked={enabled}
					onCheckedChange={(value) => setProviderEnabled("zuse", value)}
					aria-label={t("settings:zuse_harness_enable")}
				/>
			</div>
			{enabled && <ConnectionControls environmentId={environmentId} />}
		</SettingsGroup>
	);
}
function ConnectionControls({ environmentId }: { environmentId: string }) {
	const { message: t } = useMessages(["common", "settings"]);
	const { state, controller } = useModelConnections(environmentId);
	const generation = useRef(0);
	const [loginProvider, setLoginProvider] = useState<
		"chatgpt" | "supergrok" | null
	>(null);
	const [storage, setStorage] = useState<"local" | "account">("local");
	const [reconnectId, setReconnectId] = useState<string | undefined>();
	const setup = (provider: "chatgpt" | "supergrok", id?: string) => {
		generation.current++;
		setStorage(
			id
				? id.startsWith("account:")
					? "account"
					: "local"
				: state.accountAvailable
					? "account"
					: "local",
		);
		setReconnectId(id);
		setLoginProvider(provider);
	};
	const close = () => {
		generation.current++;
		controller.cancel();
		setLoginProvider(null);
		setReconnectId(undefined);
	};
	const error =
		state.error === null
			? null
			: state.error === "access_denied"
				? t("settings:chatgpt_error_denied")
				: state.error === "timeout"
					? t("settings:chatgpt_error_timeout")
					: state.error === "busy"
						? t("settings:chatgpt_error_busy")
						: state.error === "identity_mismatch"
							? t("settings:chatgpt_error_identity")
							: state.error === "unavailable"
								? t("settings:chatgpt_local_only")
								: t("settings:chatgpt_error_generic");
	const connect = async () => {
		const attempt = generation.current;
		await controller.connect(reconnectId, loginProvider ?? "chatgpt", storage);
		if (attempt === generation.current && !controller.snapshot().error)
			setLoginProvider(null);
	};
	return (
		<>
			<div className="flex h-9 items-center gap-2 px-3">
				<p className="min-w-0 flex-1 text-[11px] font-medium text-muted-foreground">
					{t("settings:model_connections_title")}
				</p>
				<div className="flex shrink-0 items-center gap-1">
					<Button
						className="h-7 w-7"
						size="icon-sm"
						variant="ghost"
						aria-label={t("settings:chatgpt_refresh")}
						disabled={state.busy !== null}
						onClick={() => void controller.load()}
					>
						<RefreshCw className="size-3.5" />
					</Button>
					<Menu>
						<MenuTrigger
							render={
								<Button
									className="h-7"
									size="sm"
									variant="settings"
									disabled={!state.available || state.busy !== null}
								/>
							}
						>
							<Plus className="size-3.5" />
							{t("common:add")}
						</MenuTrigger>
						<MenuPopup align="end">
							<MenuItem
								className="h-7"
								disabled={state.chatgptAvailable === false}
								onClick={() => setup("chatgpt")}
							>
								<ProviderIcon providerId="codex" className="size-4" />
								{connectionNames.chatgpt}
							</MenuItem>
							<MenuItem
								className="h-7"
								disabled={!state.supergrokAvailable}
								onClick={() => setup("supergrok")}
							>
								<ProviderIcon providerId="grok" className="size-4" />
								{connectionNames.supergrok}
							</MenuItem>
						</MenuPopup>
					</Menu>
				</div>
			</div>
			{state.loading ? (
				<div className="px-3 py-3">
					<Spinner className="size-4" />
				</div>
			) : state.connections.length === 0 ? (
				<p className="px-3 py-3 text-[11px] text-muted-foreground">
					{t(
						state.available
							? "settings:model_connections_empty"
							: "settings:chatgpt_local_only",
					)}
				</p>
			) : (
				state.connections.map((connection) => (
					<ConnectionRow
						key={connection.id}
						connection={connection}
						busy={state.busy !== null}
						onRename={(name) => controller.rename(connection.id, name)}
						onPreferred={() => void controller.preferred(connection.id)}
						onReconnect={() =>
							setup(connection.provider ?? "chatgpt", connection.id)
						}
						onDisconnect={() => void controller.disconnect(connection.id)}
					/>
				))
			)}
			{(error || state.accountError || state.warning) && (
				<div className="flex flex-col gap-1 px-3 py-2 text-[11px]">
					{error && (
						<p role="alert" className="text-destructive">
							{error}
						</p>
					)}
					{state.accountError && (
						<p role="status" className="text-muted-foreground">
							{t("settings:model_connections_account_error")}
						</p>
					)}
					{state.warning && (
						<p role="status" className="text-muted-foreground">
							{t("settings:model_connections_revocation_warning")}
						</p>
					)}
				</div>
			)}
			<Dialog
				open={loginProvider !== null}
				onOpenChange={(open) => {
					if (!open) close();
				}}
			>
				<DialogPopup className="max-w-sm" showCloseButton={false}>
					<DialogHeader>
						<div className="flex items-center gap-2">
							<ProviderIcon
								providerId={loginProvider === "supergrok" ? "grok" : "codex"}
								className="size-5"
							/>
							<DialogTitle>
								{loginProvider === "supergrok"
									? t("settings:model_connections_connect_supergrok")
									: t("settings:chatgpt_continue")}
							</DialogTitle>
						</div>
						<DialogDescription>
							{loginProvider === "supergrok"
								? t("settings:model_connections_supergrok_description")
								: t("settings:chatgpt_description")}
						</DialogDescription>
					</DialogHeader>
					<DialogPanel className="space-y-3">
						{!reconnectId && !state.signingIn && (
							<fieldset
								aria-label={t("settings:model_connections_save_to")}
								className="flex gap-1 rounded-md bg-muted/50 p-1"
							>
								<Button
									className="h-7 flex-1"
									variant={storage === "local" ? "settings" : "ghost"}
									size="sm"
									disabled={state.localAvailable === false}
									aria-pressed={storage === "local"}
									onClick={() => setStorage("local")}
								>
									{t("settings:model_connections_local_scope")}
								</Button>
								<Button
									className="h-7 flex-1"
									variant={storage === "account" ? "settings" : "ghost"}
									size="sm"
									disabled={!state.accountAvailable}
									aria-pressed={storage === "account"}
									onClick={() => setStorage("account")}
								>
									{t("settings:model_connections_account_scope")}
								</Button>
							</fieldset>
						)}
						{storage === "account" && (
							<p className="text-[11px] text-muted-foreground">
								{t("settings:model_connections_account_hint")}
							</p>
						)}
						{state.device && (
							<DeviceLoginSteps
								code={state.device.userCode}
								url={state.device.verificationUrl}
							/>
						)}
						{state.signingIn && (
							<div
								role="status"
								className="flex items-center gap-2 text-xs text-muted-foreground"
							>
								<Spinner className="size-3.5" />
								{state.device
									? t("settings:model_connections_waiting_supergrok")
									: state.loginUrl
										? t("settings:chatgpt_waiting")
										: t("settings:chatgpt_working")}
							</div>
						)}
						{error && (
							<p role="alert" className="text-xs text-destructive">
								{error}
							</p>
						)}
						{loginProvider === "chatgpt" && (
							<p className="text-[11px] text-muted-foreground">
								{t("settings:chatgpt_switching")}
							</p>
						)}
					</DialogPanel>
					<DialogFooter>
						<Button className="h-7" size="sm" variant="ghost" onClick={close}>
							{t("common:cancel")}
						</Button>
						{state.loginUrl ? (
							<Button
								className="h-7"
								size="sm"
								variant="settings"
								onClick={() => state.loginUrl && openExternal(state.loginUrl)}
							>
								{t("settings:chatgpt_open_browser")}
							</Button>
						) : (
							!state.signingIn && (
								<Button
									className="h-7 bg-foreground text-background hover:bg-foreground/90"
									size="sm"
									disabled={state.busy !== null}
									onClick={() => void connect()}
								>
									{loginProvider === "supergrok"
										? t("settings:cloud_workspace_auth_start_device_login")
										: t("settings:chatgpt_continue")}
								</Button>
							)
						)}
					</DialogFooter>
				</DialogPopup>
			</Dialog>
			<Dialog
				open={state.noticeConnectionId !== null && loginProvider === null}
				onOpenChange={(open) => {
					if (!open) void controller.acknowledgePlan();
				}}
			>
				<DialogPopup className="max-w-sm" showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>{t("settings:chatgpt_plan_title")}</DialogTitle>
						<DialogDescription>
							{t("settings:chatgpt_plan_description")}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							className="h-7"
							size="sm"
							disabled={state.busy !== null}
							onClick={() => void controller.acknowledgePlan()}
						>
							{t("settings:chatgpt_got_it")}
						</Button>
					</DialogFooter>
				</DialogPopup>
			</Dialog>
		</>
	);
}
export function ModelConnectionsPane({
	environmentId,
}: {
	environmentId: string;
}) {
	const { user } = useAuth();
	return (
		<LocalConnections
			key={`${environmentId}:${user?.id ?? "signed-out"}`}
			environmentId={environmentId}
		/>
	);
}
