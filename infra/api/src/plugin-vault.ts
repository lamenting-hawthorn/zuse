import type { DurableObjectState } from "@cloudflare/workers-types";
import type {
	PluginAttempt,
	PluginConnection,
	PluginRequest,
	PluginToolRequest,
} from "@zuse/contracts";
import {
	createPluginEngine,
	type EngineConnection,
	type PluginEngine,
} from "@zuse/executor-v2";
import {
	decryptAesGcmEnvelope,
	encryptAesGcmEnvelope,
	importAesGcmKey,
} from "./aes-gcm-envelope.ts";
import {
	assertPluginUrl,
	PLUGIN_CATALOG,
	publicPluginCatalog,
} from "./plugin-catalog.ts";
import type { PluginIdentity } from "./plugin-host.ts";

export interface PluginVaultEnv {
	readonly PLUGIN_ENCRYPTION_KEY?: string;
	readonly API_PUBLIC_ORIGIN: string;
	readonly PLUGIN_APP_ORIGIN?: string;
}
interface Attempt extends PluginAttempt {
	readonly subject: string;
	readonly tenant: string;
	readonly pluginId: string;
	readonly label: string;
	readonly stateToken?: string;
	readonly ticket?: string;
	readonly code?: string;
}
const TTL = 10 * 60_000;
const encoder = new TextEncoder();
const publicAttempt = (a: Attempt): PluginAttempt => ({
	kind: "attempt",
	id: a.id,
	connectionId: a.connectionId,
	state: a.state,
	authorizationUrl: a.state === "pending" ? a.authorizationUrl : null,
	expiresAt: a.expiresAt,
});

/** One serialized owner per tenant. SQLite and encrypted KV survive eviction.
 * Upstream mutations are never retried automatically: a timeout may have acted.
 */
export class PluginVault {
	private queue: Promise<unknown> = Promise.resolve();
	private readonly ready: Promise<PluginEngine>;
	constructor(
		private readonly ctx: DurableObjectState,
		private readonly env: PluginVaultEnv,
	) {
		this.ready = ctx.blockConcurrencyWhile(async () => {
			const version = await ctx.storage.get("schema-version");
			if (version !== undefined && version !== 2)
				throw new Error("Plugin storage requires an explicit v1 migration");
			if (!env.PLUGIN_ENCRYPTION_KEY)
				throw new Error("Plugins are not configured");
			const engine = await createPluginEngine({
				storage: ctx.storage,
				encryptionKey: env.PLUGIN_ENCRYPTION_KEY,
				credentialScope: ctx.id.toString(),
				plugins: PLUGIN_CATALOG,
				fetch: async (input, init) => {
					assertPluginUrl(
						typeof input === "string"
							? input
							: input instanceof URL
								? input.href
								: input.url,
					);
					const response = await fetch(input, {
						...init,
						redirect: "manual",
						signal: AbortSignal.any([
							...(init?.signal ? [init.signal] : []),
							AbortSignal.timeout(30_000),
						]),
					});
					if (response.status >= 300 && response.status < 400)
						throw new Error("Plugin redirects are not allowed");
					return response;
				},
			});
			await ctx.storage.put("schema-version", 2);
			return engine;
		});
	}
	private owner(identity: PluginIdentity) {
		return JSON.stringify([identity.tenant, identity.subject]);
	}
	private refKey(subject: string, id: string) {
		return `engine:${subject}:${id}`;
	}
	private async ref(subject: string, id: string) {
		const ref = await this.ctx.storage.get<EngineConnection>(
			this.refKey(subject, id),
		);
		if (!ref) throw new Error("Connection unavailable");
		return ref;
	}
	private cryptoKey?: Promise<CryptoKey>;
	private async key() {
		if (!this.env.PLUGIN_ENCRYPTION_KEY)
			throw new Error("Plugins are not configured");
		this.cryptoKey ??= importAesGcmKey(this.env.PLUGIN_ENCRYPTION_KEY);
		return this.cryptoKey;
	}
	private async read<T>(id: string): Promise<T | undefined> {
		const sealed = await this.ctx.storage.get<string>(id);
		if (!sealed) return undefined;
		const bytes = await decryptAesGcmEnvelope({
			key: await this.key(),
			additionalData: encoder.encode(`${this.ctx.id}:${id}`),
			envelope: JSON.parse(sealed),
		});
		return JSON.parse(new TextDecoder().decode(bytes));
	}
	private seal(id: string, value: unknown): Promise<string> {
		return this.key().then((key) =>
			encryptAesGcmEnvelope({
				key,
				additionalData: encoder.encode(`${this.ctx.id}:${id}`),
				plaintext: encoder.encode(JSON.stringify(value)),
			}),
		);
	}
	private async write(id: string, value: unknown) {
		await this.ctx.storage.put(id, await this.seal(id, value));
	}
	private async commit(values: Record<string, unknown>, remove: string[] = []) {
		await this.ctx.storage.transaction(async (storage) => {
			await storage.put(values);
			if (remove.length) await storage.delete(remove);
		});
	}

	fetch(request: Request): Promise<Response> {
		const task = this.queue.then(async () => {
			const executor = await this.ready;
			try {
				const url = new URL(request.url);
				if (url.pathname === "/callback") return await this.callback(url);
				const { identity, command, tool } = (await request.json()) as {
					identity: PluginIdentity;
					command?: PluginRequest;
					tool?: PluginToolRequest;
				};
				const saved = await this.ctx.storage.get<string>("tenant");
				if (saved && saved !== identity.tenant)
					throw new Error("Tenant mismatch");
				if (!saved) await this.ctx.storage.put("tenant", identity.tenant);
				return Response.json(
					tool
						? await this.tools(executor, identity, tool)
						: await this.command(
								executor,
								identity,
								command ??
									(() => {
										throw new Error("Missing command");
									})(),
							),
				);
			} catch {
				return Response.json(
					{ error: "plugin_operation_failed" },
					{ status: 400 },
				);
			}
		});
		this.queue = task.catch(() => undefined);
		return task;
	}
	private async command(
		e: PluginEngine,
		identity: PluginIdentity,
		input: PluginRequest,
	) {
		const prefix = `connection:${identity.subject}:`;
		if (input.action === "list") {
			const rows = await this.ctx.storage.list<PluginConnection>({ prefix });
			return {
				kind: "snapshot",
				tenants: [],
				tenantId: identity.tenant,
				endpoint: `${this.env.API_PUBLIC_ORIGIN}/v1/plugins/${encodeURIComponent(identity.tenant)}/mcp`,
				catalog: publicPluginCatalog(),
				connections: [...rows.values()],
			};
		}
		if (input.action === "disconnect") {
			const row = await this.ctx.storage.get<PluginConnection>(
				prefix + input.connectionId,
			);
			if (!row) throw new Error("Connection not found");
			// Fence invocation before the multi-step SDK deletion, including partial failures.
			await this.ctx.storage.put(prefix + row.id, { ...row, state: "error" });
			await e.remove(
				this.owner(identity),
				row.id,
				await this.ctx.storage.get<EngineConnection>(
					this.refKey(identity.subject, row.id),
				),
			);
			await this.ctx.storage.delete(this.refKey(identity.subject, row.id));
			await this.ctx.storage.delete(prefix + row.id);
			return { kind: "ok" };
		}
		if (input.action === "connect") {
			const id = `c${input.requestId.replaceAll("-", "")}`;
			if (
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
					input.requestId,
				) ||
				input.label.length > 80
			)
				throw new Error("Invalid request");
			const old = await this.read<Attempt>(`attempt:${identity.subject}:${id}`);
			if (old) return publicAttempt(old);
			const plugin = PLUGIN_CATALOG.find((p) => p.id === input.pluginId);
			if (!plugin) throw new Error("Unknown plugin");
			const a: Attempt = {
				kind: "attempt",
				id,
				connectionId: id,
				state: "pending",
				authorizationUrl: null,
				expiresAt: Date.now() + TTL,
				...identity,
				pluginId: plugin.id,
				label: input.label.trim() || plugin.name,
			};
			if ((await this.ctx.storage.list({ prefix })).size >= 50)
				throw new Error("Connection limit reached");
			await this.ctx.storage.setAlarm(Date.now() + TTL);
			await this.write(`attempt:${identity.subject}:${id}`, a);
			await this.ctx.storage.put(prefix + id, {
				id,
				pluginId: plugin.id,
				label: a.label,
				owner: "user",
				state: "connecting",
				createdAt: Date.now(),
			});
			try {
				const ref = await e.prepare(
					this.owner(identity),
					identity.subject,
					id,
					plugin.id,
				);
				await this.ctx.storage.put(this.refKey(identity.subject, id), ref);
				if (plugin.auth === "none") {
					await this.finish(a);
					return publicAttempt({ ...a, state: "connected" });
				}
				const redirectUri = `${this.env.API_PUBLIC_ORIGIN}/v1/plugins/callback/${this.ctx.id}`;
				const authorizationUrl = await e.start(
					this.owner(identity),
					ref,
					a.label,
					redirectUri,
				);
				if (!plugin.origins.includes(new URL(authorizationUrl).origin))
					throw new Error("Unexpected OAuth origin");
				const state = new URL(authorizationUrl).searchParams.get("state");
				if (!state) throw new Error("Missing OAuth state");

				const next = {
					...a,
					authorizationUrl,
					stateToken: state,
				};
				const attemptKey = `attempt:${identity.subject}:${id}`;
				const stateKey = `state:${state}`;
				await this.commit({
					[attemptKey]: await this.seal(attemptKey, next),
					[stateKey]: await this.seal(stateKey, {
						subject: identity.subject,
						id,
					}),
				});
				await this.ctx.storage.setAlarm(Date.now() + TTL);
				return publicAttempt(next);
			} catch {
				await this.fail(a, "failed");
				throw new Error("Could not connect plugin");
			}
		}
		let a: Attempt | undefined;
		if (input.action === "complete") {
			const pointer = await this.read<{ subject: string; id: string }>(
				`ticket:${input.ticket}`,
			);
			if (!pointer || pointer.subject !== identity.subject)
				throw new Error("Invalid confirmation");
			a = await this.read<Attempt>(`attempt:${identity.subject}:${pointer.id}`);
		} else
			a = await this.read<Attempt>(
				`attempt:${identity.subject}:${input.attemptId}`,
			);
		if (!a || a.tenant !== identity.tenant)
			throw new Error("Attempt not found");
		if (a.state !== "pending") return publicAttempt(a);
		if (a.expiresAt <= Date.now() || input.action === "cancel") {
			return publicAttempt(await this.fail(a, "cancelled"));
		}
		if (input.action === "poll") return publicAttempt(a);
		if (!a.stateToken || !a.code || !a.ticket || a.ticket !== input.ticket)
			throw new Error("Invalid confirmation");
		// Consume before exchanging. Never retry a code or an ambiguous token exchange.
		await this.ctx.storage.delete(`ticket:${a.ticket}`);
		try {
			const callback = new URL(
				`${this.env.API_PUBLIC_ORIGIN}/v1/plugins/callback/${this.ctx.id}`,
			);
			callback.searchParams.set("state", a.stateToken);
			callback.searchParams.set("code", a.code);
			const ref = await e.complete(
				this.owner(identity),
				await this.ref(identity.subject, a.id),
				callback.href,
			);
			await this.ctx.storage.put(this.refKey(identity.subject, a.id), ref);
			await this.finish(a);
			return publicAttempt({ ...a, state: "connected" });
		} catch {
			await this.fail(a, "failed");
			throw new Error("OAuth completion failed");
		}
	}
	private async finish(a: Attempt) {
		const key = `connection:${a.subject}:${a.connectionId}`;
		const row = await this.ctx.storage.get<PluginConnection>(key);
		if (!row) throw new Error("Connection removed");
		const attemptKey = `attempt:${a.subject}:${a.id}`;
		await this.commit(
			{
				[key]: { ...row, state: "connected" },
				[attemptKey]: await this.seal(attemptKey, {
					...a,
					state: "connected",
					code: undefined,
					ticket: undefined,
					authorizationUrl: null,
				}),
			},
			[
				...(a.stateToken ? [`state:${a.stateToken}`] : []),
				...(a.ticket ? [`ticket:${a.ticket}`] : []),
			],
		);
	}

	private async fail(a: Attempt, state: "failed" | "cancelled") {
		const next = {
			...a,
			state,
			authorizationUrl: null,
			code: undefined,
			ticket: undefined,
		};
		await this.write(`attempt:${a.subject}:${a.id}`, next);
		const connectionKey = `connection:${a.subject}:${a.connectionId}`;
		const row = await this.ctx.storage.get<PluginConnection>(connectionKey);
		if (row)
			await this.ctx.storage.put(connectionKey, { ...row, state: "error" });
		const ref = await this.ctx.storage.get<EngineConnection>(
			this.refKey(a.subject, a.id),
		);
		await (await this.ready).remove(this.owner(a), a.id, ref);
		await this.ctx.storage.delete(this.refKey(a.subject, a.id));
		await this.ctx.storage.delete(connectionKey);

		if (a.stateToken) await this.ctx.storage.delete(`state:${a.stateToken}`);
		if (a.ticket) await this.ctx.storage.delete(`ticket:${a.ticket}`);
		return next;
	}
	private async callback(url: URL): Promise<Response> {
		const state = url.searchParams.get("state");
		if (!state || state.length > 4096) throw new Error("Missing OAuth state");
		const pointer = await this.read<{ subject: string; id: string }>(
			`state:${state}`,
		);
		if (!pointer) throw new Error("Unknown OAuth state");
		const a = await this.read<Attempt>(
			`attempt:${pointer.subject}:${pointer.id}`,
		);
		if (a?.state !== "pending" || a.ticket || a.expiresAt <= Date.now())
			throw new Error("Expired OAuth state");
		if (url.searchParams.has("error")) {
			await this.fail(a, "cancelled");
			return new Response("Connection cancelled. You can close this window.", {
				headers: { "content-type": "text/plain", "cache-control": "no-store" },
			});
		}
		const code = url.searchParams.get("code");
		if (!code || code.length > 8192) throw new Error("Missing OAuth code");
		const ticket = crypto.randomUUID();
		const attemptKey = `attempt:${a.subject}:${a.id}`;
		const ticketKey = `ticket:${ticket}`;
		await this.commit(
			{
				[attemptKey]: await this.seal(attemptKey, { ...a, code, ticket }),
				[ticketKey]: await this.seal(ticketKey, pointer),
			},
			[`state:${state}`],
		);
		const target = new URL(
			this.env.PLUGIN_APP_ORIGIN ??
				(() => {
					throw new Error("Plugin app origin is missing");
				})(),
		);
		target.searchParams.set("plugin_ticket", ticket);
		target.searchParams.set("plugin_tenant", a.tenant);
		return new Response(null, {
			status: 302,
			headers: {
				location: target.href,
				"cache-control": "no-store",
				"referrer-policy": "no-referrer",
			},
		});
	}
	private async tools(
		e: PluginEngine,
		identity: PluginIdentity,
		input: PluginToolRequest,
	) {
		const rows = await this.ctx.storage.list<PluginConnection>({
			prefix: `connection:${identity.subject}:`,
		});
		const connected = [...rows.values()].filter((r) => r.state === "connected");
		const prefix = (row: PluginConnection) =>
			`tools.${row.pluginId}.user.${row.id}.`;
		if (input.action === "search") {
			const query = input.query.slice(0, 200).toLowerCase();
			const tools = [];
			for (const row of connected) {
				const list = await e.list(
					this.owner(identity),
					await this.ref(identity.subject, row.id),
				);
				for (const tool of list) {
					if (`${tool.name} ${tool.description}`.toLowerCase().includes(query))
						tools.push({
							address: prefix(row) + tool.name,
							description: tool.description,
						});
					if (tools.length >= 100) return tools;
				}
			}
			return tools;
		}
		const row = connected.find((r) => input.address.startsWith(prefix(r)));
		if (!row) throw new Error("Connection unavailable");
		const ref = await this.ref(identity.subject, row.id);
		const tool = input.address.slice(prefix(row).length);
		return input.action === "schema"
			? e.schema(this.owner(identity), ref, tool)
			: e.call(this.owner(identity), ref, tool, input.arguments);
	}

	alarm(): Promise<void> {
		const task = this.queue.then(() => this.sweep());
		this.queue = task.catch(() => undefined);
		return task;
	}
	private async sweep() {
		// Tokens and callbacks are short-lived; retained terminal attempts support retries.
		const entries = await this.ctx.storage.list<string>({ prefix: "attempt:" });
		for (const key of entries.keys()) {
			const a = await this.read<Attempt>(key);
			if (a && a.expiresAt <= Date.now()) {
				if (a.state === "pending") await this.fail(a, "cancelled");
				if (a.expiresAt + 86400_000 < Date.now())
					await this.ctx.storage.delete(key);
			}
		}
		if (entries.size) await this.ctx.storage.setAlarm(Date.now() + TTL);
	}
}
