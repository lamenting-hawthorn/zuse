import type {
	PluginAttempt,
	PluginDefinition,
	PluginSnapshot,
} from "@zuse/contracts";
import { ArrowLeft, Check, Cloud, Plus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "~/hooks/use-auth.ts";
import { openExternal } from "~/lib/platform-capabilities.ts";
import { pluginRequest } from "~/lib/plugins-client.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";

function PluginIcon({ id }: { id: string }) {
	return (
		<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
			{id === "linear" ? (
				<span className="size-5 rounded-full bg-indigo-400 [background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,var(--color-background)_2px,var(--color-background)_4px)]" />
			) : (
				<Cloud className="size-5 text-orange-400" />
			)}
		</span>
	);
}
export function PluginsPane() {
	const { user } = useAuth();
	const [snapshot, setSnapshot] = useState<PluginSnapshot | null>(null);
	const [tenant, setTenant] = useState<string>();
	const [search, setSearch] = useState("");
	const [tab, setTab] = useState<"all" | "connected">("all");
	const [selected, setSelected] = useState<string>();
	const [attempt, setAttempt] = useState<PluginAttempt | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const generation = useRef(0);
	const load = useCallback(async () => {
		const current = generation.current;
		try {
			const result = await pluginRequest({ action: "list", tenantId: tenant });
			if (current === generation.current && result.kind === "snapshot") {
				setSnapshot(result);
				const pending = result.connections.find(
					(connection) => connection.state === "connecting",
				);
				if (pending) {
					const status = await pluginRequest({
						action: "poll",
						tenantId: result.tenantId,
						attemptId: pending.id,
					});
					if (
						current === generation.current &&
						status.kind === "attempt" &&
						status.state === "pending"
					)
						setAttempt(status);
				}

				setError(undefined);
			}
		} catch {
			if (current === generation.current)
				setError(
					"Could not load plugins. Sign in to your Zuse account and try again.",
				);
		}
	}, [tenant]);
	useEffect(() => {
		generation.current++;
		setSnapshot(null);
		setAttempt(null);
		void load();
		return () => {
			generation.current++;
		};
	}, [load, user?.id]);
	useEffect(() => {
		if (!attempt || !snapshot || attempt.state !== "pending") return;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try {
				const result = await pluginRequest({
					action: "poll",
					tenantId: snapshot.tenantId,
					attemptId: attempt.id,
				});
				if (stopped) return;
				if (result.kind === "attempt" && result.state !== "pending") {
					setAttempt(null);
					if (result.state !== "connected")
						setError(
							"Connection was cancelled or expired. Try connecting again.",
						);
					await load();
					return;
				}
			} catch {
				if (!stopped) setError("Could not check the connection. Retrying…");
			}
			if (!stopped) timer = setTimeout(poll, 2000);
		};
		timer = setTimeout(poll, 1500);
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	}, [attempt, snapshot, load]);
	const connect = async (plugin: PluginDefinition) => {
		if (!snapshot || busy || attempt) return;
		const current = generation.current;
		setBusy(true);
		setError(undefined);
		try {
			const result = await pluginRequest({
				action: "connect",
				tenantId: snapshot.tenantId,
				pluginId: plugin.id,
				label: plugin.name,
				requestId: crypto.randomUUID(),
			});
			if (current !== generation.current) return;
			if (result.kind === "attempt" && result.state === "pending") {
				setAttempt(result);
				if (result.authorizationUrl)
					await openExternal(result.authorizationUrl);
			}
			await load();
		} catch {
			if (current === generation.current)
				setError("Could not connect this plugin. Please try again.");
		} finally {
			if (current === generation.current) setBusy(false);
		}
	};
	const disconnect = async (connectionId: string) => {
		if (!snapshot) return;
		setBusy(true);
		setError(undefined);
		try {
			await pluginRequest({
				action: "disconnect",
				tenantId: snapshot.tenantId,
				connectionId,
			});
			await load();
		} catch {
			setError("Could not disconnect. Try again.");
		} finally {
			setBusy(false);
		}
	};
	const plugin = snapshot?.catalog.find((p) => p.id === selected);
	const connected =
		snapshot?.connections.filter((c) => c.state === "connected") ?? [];
	const catalog =
		snapshot?.catalog.filter(
			(p) =>
				`${p.name} ${p.description}`
					.toLowerCase()
					.includes(search.toLowerCase()) &&
				(tab === "all" || connected.some((c) => c.pluginId === p.id)),
		) ?? [];
	return (
		<section className="flex min-h-0 flex-1 flex-col gap-5 text-xs">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h2 className="text-base font-medium">Plugins</h2>
					<p className="mt-1 text-muted-foreground">
						Connect your tools once. Use them in local and cloud chats.
					</p>
				</div>
				<Button
					variant="ghost"
					className="h-7 w-7 p-0"
					aria-label="Refresh plugins"
					disabled={busy}
					onClick={() => void load()}
				>
					<RefreshCw className="size-3.5" />
				</Button>
			</div>
			{snapshot && snapshot.tenants.length > 1 && (
				<select
					aria-label="Plugin account"
					className="h-7 max-w-48 rounded-md bg-muted px-2"
					value={snapshot.tenantId}
					disabled={busy || !!attempt}
					onChange={(e) => {
						setTenant(e.target.value);
						setSelected(undefined);
					}}
				>
					{snapshot.tenants.map((t) => (
						<option key={t.id} value={t.id}>
							{t.name}
						</option>
					))}
				</select>
			)}
			{error && (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			)}
			{attempt && (
				<div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-3">
					<span className="flex-1 text-muted-foreground">
						Finish connecting in your browser, then confirm with your Zuse
						account.
					</span>
					{attempt.authorizationUrl && (
						<Button
							variant="ghost"
							className="h-7"
							onClick={() =>
								attempt.authorizationUrl &&
								void openExternal(attempt.authorizationUrl)
							}
						>
							Open browser
						</Button>
					)}
					<Button
						variant="ghost"
						className="h-7"
						onClick={async () => {
							if (snapshot) {
								try {
									await pluginRequest({
										action: "cancel",
										tenantId: snapshot.tenantId,
										attemptId: attempt.id,
									});
									setAttempt(null);
									await load();
								} catch {
									setError("Could not cancel. Try again.");
								}
							}
						}}
					>
						Cancel
					</Button>
				</div>
			)}
			{!snapshot && !error && (
				<p role="status" className="text-muted-foreground">
					Loading plugins…
				</p>
			)}
			{plugin ? (
				<>
					<button
						type="button"
						onClick={() => setSelected(undefined)}
						className="flex h-7 items-center gap-1 self-start text-muted-foreground hover:text-foreground"
					>
						<ArrowLeft className="size-3" />
						All plugins
					</button>
					<div className="flex items-center gap-3">
						<PluginIcon id={plugin.id} />
						<div className="flex-1">
							<h3 className="text-base font-medium">{plugin.name}</h3>
							<p className="mt-1 text-muted-foreground">{plugin.description}</p>
						</div>
						<Button
							className="h-7"
							disabled={busy || !!attempt}
							onClick={() => void connect(plugin)}
						>
							<Plus className="size-3" />
							Connect
						</Button>
					</div>
					<div className="rounded-xl bg-muted/40 p-5">
						<p className="font-medium">Try it in a chat</p>
						<p className="mt-3 text-muted-foreground">
							{plugin.id === "linear"
								? "Find my open Linear issues and help me plan what to work on next."
								: "Find the Cloudflare documentation for deploying a Worker with Durable Objects."}
						</p>
					</div>
					<div>
						<h4 className="mb-3 font-medium">Your connections</h4>
						{snapshot?.connections
							.filter((c) => c.pluginId === plugin.id)
							.map((c) => (
								<div key={c.id} className="flex items-center gap-3 py-2">
									<Check className="size-3 text-muted-foreground" />
									<span className="flex-1">
										{c.label}
										<span className="ml-2 text-muted-foreground">
											{c.state}
										</span>
									</span>
									<Button
										variant="ghost"
										className="h-7"
										disabled={busy}
										onClick={() => void disconnect(c.id)}
									>
										Disconnect
									</Button>
								</div>
							))}
						{!snapshot?.connections.some((c) => c.pluginId === plugin.id) && (
							<p className="text-muted-foreground">No connections yet.</p>
						)}
					</div>
					<p className="text-muted-foreground">
						Connections are private to your Zuse account. Calls follow your
						chat’s permission settings. Disconnecting stops new calls from Zuse.
					</p>
				</>
			) : (
				<>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex gap-1">
							{(["all", "connected"] as const).map((t) => (
								<Button
									key={t}
									variant={tab === t ? "secondary" : "ghost"}
									className="h-7 rounded-full"
									onClick={() => setTab(t)}
								>
									{t === "all" ? "Browse" : "Connected"}
								</Button>
							))}
						</div>
						<div className="relative">
							<Search className="absolute left-2 top-2 size-3 text-muted-foreground" />
							<Input
								aria-label="Search plugins"
								placeholder="Search plugins"
								className="h-7 w-52 pl-7"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
							/>
						</div>
					</div>
					<div className="grid grid-cols-1 gap-x-6 gap-y-1 lg:grid-cols-2">
						{catalog.map((p) => (
							<div
								key={p.id}
								className="flex items-center gap-3 rounded-xl px-2 py-3 hover:bg-muted/40"
							>
								<button
									type="button"
									className="flex min-w-0 flex-1 items-center gap-3 text-left"
									onClick={() => setSelected(p.id)}
								>
									<PluginIcon id={p.id} />
									<span>
										<span className="font-medium">{p.name}</span>
										<span className="mt-1 block text-muted-foreground">
											{p.description}
										</span>
									</span>
								</button>
								<Button
									variant="ghost"
									className="h-7 w-7 shrink-0 p-0"
									aria-label={
										connected.some((c) => c.pluginId === p.id)
											? `Manage ${p.name}`
											: `Connect ${p.name}`
									}
									disabled={busy || !!attempt}
									onClick={() =>
										connected.some((c) => c.pluginId === p.id)
											? setSelected(p.id)
											: void connect(p)
									}
								>
									{connected.some((c) => c.pluginId === p.id) ? (
										<Check className="size-4" />
									) : (
										<Plus className="size-4" />
									)}
								</Button>
							</div>
						))}
					</div>
					{snapshot && !catalog.length && (
						<p className="py-8 text-center text-muted-foreground">
							{tab === "connected" && !search
								? "Your connected plugins will appear here."
								: "No plugins match your search."}
						</p>
					)}
				</>
			)}
		</section>
	);
}
