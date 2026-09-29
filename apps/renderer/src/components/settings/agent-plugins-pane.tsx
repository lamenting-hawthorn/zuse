import "@zuse/i18n/english/extensions";
import type { ExecutorCommand, ExecutorState } from "@zuse/contracts";
import { useMessages } from "@zuse/i18n/react";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/error-message.ts";
import { executorActions } from "../../lib/executor-client.ts";
import { openExternal } from "../../lib/platform-capabilities.ts";
import { useEnvironmentCatalogStore } from "../../store/environment-catalog.ts";
import { Button } from "../ui/button.tsx";

export function AgentPluginsPane() {
	const environment = useEnvironmentCatalogStore((s) => s.activeEnvironmentId);
	return <ExecutorPlugins key={environment} environmentId={environment} />;
}
function ExecutorPlugins({ environmentId }: { environmentId: string }) {
	const { message: t } = useMessages(["extensions"]);
	const [state, setState] = useState<ExecutorState | null>(null);
	const [url, setUrl] = useState("");
	const [token, setToken] = useState("");
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const generation = useRef(0);
	const pending = useRef(false);
	const perform = async (work: () => Promise<ExecutorState>) => {
		if (pending.current) return;
		pending.current = true;
		const version = ++generation.current;
		setBusy(true);
		setError(null);
		try {
			const result = await work();
			if (version !== generation.current) return;
			setState(result);
			setUrl(result.url ?? "");
			setToken("");
			setEditing(false);
		} catch (cause) {
			if (version === generation.current)
				setError(errorMessage(cause, t("extensions:executor_failed")));
		} finally {
			if (version === generation.current) {
				pending.current = false;
				setBusy(false);
			}
		}
	};
	useEffect(() => {
		void perform(() => executorActions.state(environmentId));
		return () => {
			generation.current++;
			pending.current = false;
		};
	}, [environmentId]);
	const execute = (command: ExecutorCommand) =>
		perform(() => executorActions.execute(environmentId, command));
	const visible =
		state?.integrations.filter((item) =>
			`${item.slug} ${item.name} ${item.description} ${item.kind} ${state.connections
				.filter((account) => account.integration === item.slug)
				.map((account) => `${account.name} ${account.identityLabel ?? ""}`)
				.join(" ")}`
				.toLowerCase()
				.includes(query.toLowerCase()),
		) ?? [];
	const inputClass = "h-7 min-w-0 rounded-md bg-muted/45 px-2.5 text-xs";
	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground">
				{t("extensions:executor_intro")}
			</p>
			<p className="text-[11px] text-muted-foreground">
				{t("extensions:executor_environment", { name: environmentId })}
			</p>
			{busy ? (
				<p role="status" className="text-xs text-muted-foreground">
					{t("extensions:plugins_working")}
				</p>
			) : null}
			{error || state?.error ? (
				<p role="alert" className="text-xs text-destructive">
					{error ?? state?.error}
				</p>
			) : null}
			{(state ? !state.configured || editing : !busy) ? (
				<form
					className="space-y-2"
					onSubmit={(event) => {
						event.preventDefault();
						if (url.trim() && token.trim())
							void execute({ _tag: "connect", url: url.trim(), token });
					}}
				>
					<label className="block space-y-1 text-xs">
						<span>{t("extensions:executor_url")}</span>
						<input
							className={`${inputClass} w-full`}
							type="url"
							required
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							disabled={busy}
						/>
					</label>
					<label className="block space-y-1 text-xs">
						<span>{t("extensions:executor_key")}</span>
						<input
							className={`${inputClass} w-full`}
							type="password"
							autoComplete="off"
							required
							value={token}
							onChange={(event) => setToken(event.target.value)}
							disabled={busy}
						/>
					</label>
					<p className="text-[11px] text-muted-foreground">
						{t("extensions:executor_key_help")}
					</p>
					<Button
						type="submit"
						className="h-7"
						size="sm"
						disabled={busy || !url.trim() || !token.trim()}
					>
						{t("extensions:executor_connect")}
					</Button>
					{state?.configured ? (
						<Button
							type="button"
							className="ml-2 h-7"
							variant="ghost"
							size="sm"
							disabled={busy}
							onClick={() => {
								setEditing(false);
								setToken("");
							}}
						>
							{t("extensions:plugins_close")}
						</Button>
					) : null}
				</form>
			) : null}
			{state?.configured && !editing ? (
				<>
					<div className="flex flex-wrap items-center gap-2 text-xs">
						<span className="min-w-0 flex-1 truncate">{state.url}</span>
						<Button
							className="h-7"
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() =>
								void execute({
									_tag: "configure",
									enabled: !state.enabled,
									toolkit: state.toolkit,
								})
							}
						>
							{state.enabled
								? t("extensions:plugins_disable")
								: t("extensions:plugins_enable")}
						</Button>
						<Button
							className="h-7"
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => setEditing(true)}
						>
							{t("extensions:executor_reconnect")}
						</Button>
						<Button
							className="h-7"
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => {
								if (window.confirm(t("extensions:executor_disconnect_confirm")))
									void execute({ _tag: "disconnect" });
							}}
						>
							{t("extensions:executor_disconnect")}
						</Button>
					</div>
					<label className="flex items-center gap-2 text-xs">
						<span>{t("extensions:executor_toolkit")}</span>
						<select
							className={`${inputClass} flex-1`}
							value={state.toolkit ?? ""}
							disabled={busy || !!state.error}
							onChange={(event) =>
								void execute({
									_tag: "configure",
									enabled: state.enabled,
									toolkit: event.target.value || null,
								})
							}
						>
							<option value="">{t("extensions:executor_all_tools")}</option>
							{state.toolkit &&
							!state.toolkits.some((item) => item.slug === state.toolkit) ? (
								<option value={state.toolkit}>{state.toolkit}</option>
							) : null}
							{state.toolkits.map((item) => (
								<option key={item.id} value={item.slug}>
									{item.name}
								</option>
							))}
						</select>
					</label>
					<p className="text-[11px] text-muted-foreground">
						{t("extensions:executor_scope_help")}
					</p>
					<div className="flex items-center gap-2">
						<input
							className={`${inputClass} flex-1`}
							aria-label={t("extensions:executor_search")}
							placeholder={t("extensions:executor_search")}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
						{state.url ? (
							<a
								className="inline-flex h-7 items-center rounded-md px-2 text-xs hover:bg-muted"
								href={state.url}
								onClick={(event) => {
									event.preventDefault();
									if (state.url)
										void openExternal(state.url).catch((cause) =>
											setError(
												errorMessage(cause, t("extensions:executor_failed")),
											),
										);
								}}
								target="_blank"
								rel="noreferrer"
							>
								{t("extensions:executor_manage")}
							</a>
						) : null}
					</div>
					<div className="space-y-2">
						{visible.map((item) => {
							const accounts = state.connections.filter(
								(account) => account.integration === item.slug,
							);
							return (
								<div
									key={item.slug}
									className="rounded-md bg-muted/20 px-3 py-2"
								>
									<p className="text-xs font-medium">{item.name}</p>
									<p className="text-[11px] text-muted-foreground">
										{item.description}
									</p>
									<div className="mt-1 space-y-1">
										{accounts.map((account) => (
											<p
												key={`${account.owner}:${account.name}`}
												className="text-[11px] text-muted-foreground"
											>
												{account.identityLabel || account.name} ·{" "}
												{account.owner}
												{account.expiresAt !== null &&
												account.expiresAt < Date.now()
													? ` · ${t("extensions:executor_expired")}`
													: ""}
											</p>
										))}
									</div>
									{!accounts.length &&
									item.authMethods.some((method) => method.kind !== "none") ? (
										<p className="text-[11px] text-muted-foreground">
											{t("extensions:executor_no_account")}
										</p>
									) : null}
								</div>
							);
						})}
					</div>
					{!busy && !state.error && !visible.length ? (
						<p className="text-xs text-muted-foreground">
							{t("extensions:executor_empty")}
						</p>
					) : null}
				</>
			) : null}
			<Button
				className="h-7"
				size="sm"
				variant="ghost"
				disabled={busy}
				onClick={() => void perform(() => executorActions.state(environmentId))}
			>
				{t("extensions:plugins_refresh")}
			</Button>
		</div>
	);
}
