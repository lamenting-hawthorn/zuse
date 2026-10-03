import type {
	AcpCatalogEntry,
	AcpDefinition,
	AcpDefinitionInput,
} from "@zuse/contracts";
import { EnvironmentId } from "@zuse/contracts";
import { ExternalLink, MoreHorizontal, Plus, Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { openExternal } from "../lib/platform-capabilities.ts";
import {
	PROVIDER_STATUS_STYLES,
	type ProviderStatusKey,
} from "../lib/provider-status.ts";
import { cn } from "../lib/utils.ts";
import {
	ACP_SIGN_IN_LABEL,
	authenticateAcpAgent,
	cancelAcpSignIn,
	EMPTY_ACP_HOST,
	loadAcpAgents,
	loadAcpCatalog,
	runAcpOperation,
	testAcpAgent,
	useAcpAgentsStore,
} from "../store/acp-agents.ts";
import { AcpAgentLogo } from "./provider-icons.tsx";
import { PtyTerminal } from "./terminal-pane.tsx";
import { Button } from "./ui/button.tsx";
import { CompactEmptyState } from "./ui/compact-empty-state.tsx";
import {
	Dialog,
	DialogFooter,
	DialogHeader,
	DialogPanel,
	DialogPopup,
	DialogTitle,
} from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";
import {
	Menu,
	MenuItem,
	MenuPopup,
	MenuSeparator,
	MenuTrigger,
} from "./ui/menu.tsx";
import { SettingsGroup } from "./ui/settings-panel.tsx";
import { Spinner } from "./ui/spinner.tsx";
import { Switch } from "./ui/switch.tsx";

type DialogState =
	| { kind: "catalog" }
	| { kind: "command"; agent?: AcpDefinition }
	| null;

export function AcpAgentManager({ environmentId }: { environmentId: string }) {
	const state = useAcpAgentsStore(
		(store) => store.hosts[environmentId] ?? EMPTY_ACP_HOST,
	);
	const [dialog, setDialog] = useState<DialogState>(null);
	useEffect(() => {
		void loadAcpAgents(environmentId);
		setDialog(null);
	}, [environmentId]);
	const busy = state.busy !== null;
	const signingIn =
		state.terminal !== undefined ||
		Boolean(state.authUrl) ||
		state.busy === ACP_SIGN_IN_LABEL;

	return (
		<>
			<SettingsGroup
				title="ACP agents"
				action={
					<div className="flex items-center gap-1.5">
						{state.busy && (
							<span
								role="status"
								className="flex max-w-48 items-center gap-1.5 truncate text-[10px] text-muted-foreground"
							>
								<Spinner className="size-3" />
								{state.busy}
							</span>
						)}
						<Button
							className="h-7"
							size="sm"
							variant="settings"
							disabled={busy}
							onClick={() => {
								setDialog({ kind: "catalog" });
								void loadAcpCatalog(environmentId);
							}}
						>
							<Plus className="size-3.5" />
							Add
						</Button>
					</div>
				}
			>
				{state.definitions.length === 0 ? (
					<CompactEmptyState title="No ACP agents yet" />
				) : (
					state.definitions.map((agent) => (
						<AcpAgentRow
							key={agent.id}
							agent={agent}
							busy={busy}
							testing={state.testing.includes(agent.id)}
							environmentId={environmentId}
							onEdit={() => setDialog({ kind: "command", agent })}
						/>
					))
				)}
				{signingIn && (
					<div className="flex flex-col gap-2 px-3 py-2.5">
						<div className="flex h-7 items-center gap-2">
							<Spinner className="size-3" />
							<p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
								Finish signing in on this host.
							</p>
							{state.authUrl && (
								<Button
									className="h-7"
									size="sm"
									variant="settings"
									onClick={() => void openExternal(state.authUrl ?? "")}
								>
									<ExternalLink className="size-3.5" />
									Open sign-in page
								</Button>
							)}
							<Button
								className="h-7"
								size="sm"
								variant="ghost"
								onClick={() => cancelAcpSignIn(environmentId)}
							>
								Cancel
							</Button>
						</div>
						{state.terminal && (
							<div className="h-64 overflow-hidden rounded-md bg-muted/30">
								<PtyTerminal
									cwd={state.terminal.cwd}
									environmentId={EnvironmentId.make(environmentId)}
									instanceId={state.terminal.ptyId}
									serverPtyId={state.terminal.ptyId}
									processEpoch={state.terminal.processEpoch}
									ownerId={state.terminal.ownerId}
									title="Agent sign in"
								/>
							</div>
						)}
					</div>
				)}
				{state.error && (
					<p role="alert" className="px-3 py-2 text-[11px] text-destructive">
						{state.error}
					</p>
				)}
			</SettingsGroup>
			<AcpCatalogDialog
				open={dialog?.kind === "catalog"}
				catalog={state.catalog}
				loading={state.catalogLoading}
				error={state.error}
				busy={busy}
				environmentId={environmentId}
				onClose={() => setDialog(null)}
				onCustom={() => setDialog({ kind: "command" })}
			/>
			<AcpCommandDialog
				key={
					dialog?.kind === "command" ? (dialog.agent?.id ?? "new") : "closed"
				}
				open={dialog?.kind === "command"}
				agent={dialog?.kind === "command" ? dialog.agent : undefined}
				busy={busy}
				onClose={() => setDialog(null)}
				save={async (input) => {
					const result = await runAcpOperation(
						environmentId,
						"Saving agent…",
						(client) => client["provider.acp.save"](input),
					);
					if (!result) return;
					setDialog(null);
					await testAcpAgent(environmentId, result.id);
				}}
			/>
		</>
	);
}

function agentStatus(
	agent: AcpDefinition,
	testing: boolean,
): {
	key: ProviderStatusKey;
	label: string;
} {
	if (!agent.enabled) return { key: "disabled", label: "Disabled" };
	if (testing)
		return {
			key: "loading",
			label: agent.probe ? "Testing connection…" : "Setting up…",
		};
	if (!agent.probe) return { key: "disabled", label: "Connection not tested" };
	const key: ProviderStatusKey =
		agent.probe.status === "ready"
			? "ready"
			: agent.probe.status === "authentication-required"
				? "warning"
				: "error";
	return { key, label: agent.probe.message };
}

function AcpAgentRow({
	agent,
	busy,
	testing,
	environmentId,
	onEdit,
}: {
	agent: AcpDefinition;
	busy: boolean;
	testing: boolean;
	environmentId: string;
	onEdit: () => void;
}) {
	const status = agentStatus(agent, testing);
	const authMethods =
		!testing &&
		agent.enabled &&
		agent.probe?.status === "authentication-required"
			? agent.probe.authMethods
			: [];
	const signIn = (methodId: string) =>
		void authenticateAcpAgent(environmentId, agent.id, methodId);
	return (
		<div className="flex min-h-12 items-center gap-3 px-3 py-2">
			<span
				className={cn(
					"grid size-7 shrink-0 place-items-center rounded-md bg-muted/60",
					!agent.enabled && "opacity-60",
				)}
			>
				<AcpAgentLogo icon={agent.icon} className="size-4" />
			</span>
			<div
				className={cn(
					"flex min-w-0 flex-1 flex-col gap-0.5",
					!agent.enabled && "opacity-60",
				)}
			>
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-xs font-medium text-foreground">
						{agent.name}
					</span>
					{agent.version && (
						<span className="shrink-0 font-mono text-[10px] text-muted-foreground">
							{agent.version}
						</span>
					)}
				</div>
				<div
					className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
					title={status.label}
				>
					<span
						className={cn(
							"size-1.5 shrink-0 rounded-full",
							PROVIDER_STATUS_STYLES[status.key].dot,
						)}
						aria-hidden
					/>
					<span className="truncate">{status.label}</span>
				</div>
			</div>
			{authMethods.length === 1 && (
				<Button
					className="h-7"
					size="sm"
					variant="settings"
					disabled={busy}
					onClick={() => signIn(authMethods[0]?.id ?? "")}
				>
					Sign in
				</Button>
			)}
			{authMethods.length > 1 && (
				<Menu>
					<MenuTrigger
						render={
							<Button
								className="h-7"
								size="sm"
								variant="settings"
								disabled={busy}
							/>
						}
					>
						Sign in
					</MenuTrigger>
					<MenuPopup align="end">
						{authMethods.map((method) => (
							<MenuItem
								key={method.id}
								className="h-7"
								onClick={() => signIn(method.id)}
							>
								{method.name}
							</MenuItem>
						))}
					</MenuPopup>
				</Menu>
			)}
			<Switch
				checked={agent.enabled}
				disabled={busy}
				aria-label={`Enable ${agent.name}`}
				onCheckedChange={(enabled) =>
					void runAcpOperation(environmentId, "Saving…", (client) =>
						client["provider.acp.save"]({ ...agent, enabled }),
					)
				}
			/>
			<Menu>
				<MenuTrigger
					render={
						<Button
							className="h-7 w-7 text-muted-foreground"
							size="icon-sm"
							variant="ghost"
							disabled={busy}
							aria-label={`${agent.name} actions`}
						/>
					}
				>
					<MoreHorizontal className="size-4" />
				</MenuTrigger>
				<MenuPopup align="end">
					<MenuItem
						className="h-7"
						disabled={!agent.enabled || testing}
						onClick={() => void testAcpAgent(environmentId, agent.id)}
					>
						Test connection
					</MenuItem>
					<MenuItem className="h-7" onClick={onEdit}>
						Edit
					</MenuItem>
					<MenuItem
						className="h-7"
						onClick={() =>
							void runAcpOperation(environmentId, "Duplicating…", (client) =>
								client["provider.acp.duplicate"]({ id: agent.id }),
							)
						}
					>
						Duplicate
					</MenuItem>
					{agent.catalogId && (
						<MenuItem
							className="h-7"
							onClick={() =>
								void runAcpOperation(
									environmentId,
									"Updating agent…",
									(client) =>
										client["provider.acp.install"]({
											catalogId: agent.catalogId ?? "",
											id: agent.id,
										}),
								)
							}
						>
							Update
						</MenuItem>
					)}
					<MenuSeparator />
					<MenuItem
						className="h-7"
						variant="destructive"
						onClick={() =>
							void runAcpOperation(environmentId, "Removing agent…", (client) =>
								client["provider.acp.remove"]({ id: agent.id }),
							)
						}
					>
						Remove
					</MenuItem>
				</MenuPopup>
			</Menu>
		</div>
	);
}

function AcpCatalogDialog({
	open,
	catalog,
	loading,
	error,
	busy,
	environmentId,
	onClose,
	onCustom,
}: {
	open: boolean;
	catalog: readonly AcpCatalogEntry[];
	loading: boolean;
	error: string | null;
	busy: boolean;
	environmentId: string;
	onClose: () => void;
	onCustom: () => void;
}) {
	const [query, setQuery] = useState("");
	const [installing, setInstalling] = useState<string | null>(null);
	const entries = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return needle
			? catalog.filter((entry) =>
					`${entry.name} ${entry.description}`.toLowerCase().includes(needle),
				)
			: catalog;
	}, [catalog, query]);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogPopup className="max-w-md" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Add ACP agent</DialogTitle>
				</DialogHeader>
				<div className="px-4 pb-2">
					<div className="relative">
						<Search
							className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
							aria-hidden
						/>
						<Input
							className="h-7 [&_input]:ps-7"
							type="search"
							placeholder="Search agents…"
							aria-label="Search ACP agents"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							autoFocus
						/>
					</div>
				</div>
				<DialogPanel className="max-h-80 px-2 pt-0">
					{catalog.length === 0 ? (
						<div className="flex justify-center py-6">
							{loading ? (
								<Spinner className="size-4" />
							) : (
								<CompactEmptyState title="The registry is unavailable" />
							)}
						</div>
					) : entries.length === 0 ? (
						<CompactEmptyState title="No matching agents" />
					) : (
						entries.map((entry) => (
							<div
								key={entry.id}
								className="group flex h-11 items-center gap-2.5 rounded-md px-2 hover:bg-muted/40"
							>
								<span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/60">
									<AcpAgentLogo icon={entry.icon} className="size-4" />
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 items-center gap-1.5">
										<span className="truncate text-xs font-medium text-foreground">
											{entry.name}
										</span>
										{entry.origin === "community" && (
											<span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">
												Community
											</span>
										)}
									</div>
									<p
										className="truncate text-[11px] text-muted-foreground"
										title={entry.description}
									>
										{entry.description}
									</p>
								</div>
								<Button
									className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
									size="icon-sm"
									variant="ghost"
									aria-label={`${entry.name} source`}
									onClick={() => void openExternal(entry.source)}
								>
									<ExternalLink className="size-3.5" />
								</Button>
								{entry.compatible ? (
									<Button
										className="h-7"
										size="sm"
										variant="settings"
										disabled={busy}
										loading={installing === entry.id}
										onClick={async () => {
											setInstalling(entry.id);
											const installed = await runAcpOperation(
												environmentId,
												`Installing ${entry.name}…`,
												(client) =>
													client["provider.acp.install"]({
														catalogId: entry.id,
													}),
											);
											setInstalling(null);
											if (!installed) return;
											onClose();
											void testAcpAgent(environmentId, installed.id);
										}}
									>
										Add
									</Button>
								) : (
									<span
										className="flex h-7 shrink-0 items-center text-[10px] text-muted-foreground"
										title="Not available on this host"
									>
										Unavailable
									</span>
								)}
							</div>
						))
					)}
				</DialogPanel>
				{error && (
					<p role="alert" className="px-4 pb-2 text-[11px] text-destructive">
						{error}
					</p>
				)}
				<DialogFooter className="sm:justify-between">
					<Button className="h-7" size="sm" variant="ghost" onClick={onCustom}>
						Use a custom command…
					</Button>
					<Button className="h-7" size="sm" variant="ghost" onClick={onClose}>
						Done
					</Button>
				</DialogFooter>
			</DialogPopup>
		</Dialog>
	);
}

/** Splits a command line with POSIX-style quoting (no expansion). */
const splitCommandLine = (line: string): string[] => {
	const tokens: string[] = [];
	let current: string | null = null;
	let quote: '"' | "'" | null = null;
	for (let index = 0; index < line.length; index++) {
		const char = line[index] ?? "";
		if (quote === "'") {
			if (char === "'") quote = null;
			else current += char;
		} else if (char === "\\" && index + 1 < line.length) {
			current = (current ?? "") + line[++index];
		} else if (quote === '"') {
			if (char === '"') quote = null;
			else current += char;
		} else if (char === '"' || char === "'") {
			quote = char;
			current ??= "";
		} else if (/\s/.test(char)) {
			if (current !== null) tokens.push(current);
			current = null;
		} else {
			current = (current ?? "") + char;
		}
	}
	if (quote) throw new Error("Close the open quote.");
	if (current !== null) tokens.push(current);
	return tokens;
};

const quoteArgument = (arg: string) =>
	/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;

function AcpCommandDialog({
	open,
	agent,
	busy,
	onClose,
	save,
}: {
	open: boolean;
	agent?: AcpDefinition;
	busy: boolean;
	onClose: () => void;
	save: (input: AcpDefinitionInput) => Promise<void>;
}) {
	const [name, setName] = useState(agent?.name ?? "");
	const [command, setCommand] = useState(agent?.command ?? "");
	const [args, setArgs] = useState(
		(agent?.args ?? []).map(quoteArgument).join(" "),
	);
	const [env, setEnv] = useState("");
	const [clearEnv, setClearEnv] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const savedKeys = clearEnv ? [] : (agent?.envKeys ?? []);

	const submit = () => {
		try {
			const parsedArgs = splitCommandLine(args);
			const pairs = splitCommandLine(env).map((pair) => {
				const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(pair);
				if (!match)
					throw new Error(`"${pair.split("=")[0]}" is not a KEY=value pair.`);
				return [match[1] ?? "", match[2] ?? ""] as const;
			});
			setError(null);
			void save({
				id: agent?.id,
				name,
				command,
				args: parsedArgs,
				enabled: agent?.enabled ?? true,
				...(pairs.length > 0 || clearEnv
					? { env: Object.fromEntries(pairs) }
					: {}),
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogPopup className="max-w-sm" showCloseButton={false}>
				<form
					className="contents"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{agent ? `Edit ${agent.name}` : "Custom ACP command"}
						</DialogTitle>
					</DialogHeader>
					<DialogPanel className="flex flex-col gap-3">
						<Field label="Name">
							<Input
								required
								className="h-7"
								placeholder="My agent"
								value={name}
								onChange={(event) => setName(event.target.value)}
								autoFocus
							/>
						</Field>
						<Field label="Executable">
							<Input
								required
								className="h-7 font-mono"
								placeholder="my-agent"
								value={command}
								onChange={(event) => setCommand(event.target.value)}
							/>
						</Field>
						<Field label="Arguments">
							<Input
								className="h-7 font-mono"
								placeholder="--acp"
								value={args}
								onChange={(event) => setArgs(event.target.value)}
							/>
						</Field>
						<Field
							label="Environment"
							hint={
								savedKeys.length > 0 ? (
									<>
										Saved: {savedKeys.join(", ")}.{" "}
										<button
											type="button"
											className="underline-offset-2 hover:text-foreground hover:underline"
											onClick={() => setClearEnv(true)}
										>
											Clear
										</button>
									</>
								) : clearEnv ? (
									"Saved variables will be removed."
								) : undefined
							}
						>
							<Input
								type="password"
								autoComplete="off"
								className="h-7 font-mono"
								placeholder="API_KEY=… OTHER=…"
								value={env}
								onChange={(event) => setEnv(event.target.value)}
							/>
						</Field>
						{error && (
							<p role="alert" className="text-[11px] text-destructive">
								{error}
							</p>
						)}
					</DialogPanel>
					<DialogFooter>
						<Button
							type="button"
							className="h-7"
							size="sm"
							variant="ghost"
							onClick={onClose}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							className="h-7 bg-foreground text-background hover:bg-foreground/90"
							size="sm"
							disabled={busy}
						>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogPopup>
		</Dialog>
	);
}

function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: ReactNode;
	children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children.
		<label className="flex flex-col gap-1">
			<span className="text-[11px] font-medium text-muted-foreground">
				{label}
			</span>
			{children}
			{hint && (
				<span className="text-[10px] leading-4 text-muted-foreground">
					{hint}
				</span>
			)}
		</label>
	);
}
