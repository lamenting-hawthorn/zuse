import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AcpLaunch, launchAcpProcess } from "@zuse/acp/process";
import { AcpResponseError } from "@zuse/acp/rpc-client";
import {
	acpSessionInventory,
	decodeAcpSession,
	initializeAcp,
} from "@zuse/agents/drivers/acp/discovery";
import {
	AcpDefinition,
	type AcpDefinitionInput,
	AcpOperationError,
	type AcpProbe,
	type AcpProviderId,
	type AgentAvailability,
} from "@zuse/contracts";
import { Context, Effect, Layer, Schema } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { AppPaths } from "../../app-paths.ts";
import { resolveCliPath } from "../availability.ts";
import { CredentialsService } from "../services/credentials-service.ts";
import {
	distributionFor,
	installCatalogAgent,
	type RegistryAgent,
	readCatalog,
} from "./catalog.ts";
import { COMMUNITY_ACP_AGENTS } from "./community-catalog.ts";

const StoredDefinition = Schema.Struct({
	...AcpDefinition.fields,
	credentialId: Schema.optional(Schema.String),
	revision: Schema.optional(Schema.String),
});
type StoredDefinition = typeof StoredDefinition.Type;
const Stored = Schema.Array(StoredDefinition);
const publicDefinition = (entry: StoredDefinition): AcpDefinition =>
	Schema.decodeUnknownSync(AcpDefinition)(entry);
const Secrets = Schema.Record(Schema.String, Schema.String);
/** Only registry-hosted logos reach the renderer; other hosts are dropped. */
const registryIcon = (agent: RegistryAgent): { icon?: string } => {
	try {
		const url = new URL(agent.icon ?? "");
		return url.protocol === "https:" &&
			url.hostname === "cdn.agentclientprotocol.com"
			? { icon: url.href }
			: {};
	} catch {
		return {};
	}
};
export const probeAcp = async (
	launch: AcpLaunch,
	cwd: string,
	methodId?: string,
	onStderr?: (text: string) => void,
	startupTimeoutMs = 30_000,
	signal?: AbortSignal,
): Promise<AcpProbe> => {
	const commands: Array<{ name: string; description: string }> = [];
	let commandsArrived: (() => void) | undefined;
	const commandNotification = new Promise<void>((resolve) => {
		commandsArrived = resolve;
	});
	const Commands = Schema.Array(
		Schema.Struct({ name: Schema.String, description: Schema.String }),
	);
	const process = launchAcpProcess(
		launch,
		cwd,
		(message) => {
			if (message.method === "session/update") {
				const update = (
					message.params as {
						update?: {
							sessionUpdate?: string;
							availableCommands?: typeof commands;
						};
					}
				)?.update;
				if (
					update?.sessionUpdate === "available_commands_update" &&
					Array.isArray(update.availableCommands)
				) {
					const decoded = Schema.decodeUnknownOption(Commands)(
						update.availableCommands,
					);
					if (decoded._tag === "Some")
						commands.splice(0, commands.length, ...decoded.value);
					commandsArrived?.();
				}
			} else if (message.id != null)
				process.rpc.send({
					jsonrpc: "2.0",
					id: message.id,
					error: {
						code: -32601,
						message: "Client requests unavailable during connection test",
					},
				});
		},
		undefined,
		onStderr,
	);
	let authMethods: AcpProbe["authMethods"] = [];
	let loadSession = false;
	// A cancelled sign-in must release the agent and its OAuth callback port.
	const abort = () => process.close();
	signal?.addEventListener("abort", abort, { once: true });
	try {
		if (signal?.aborted) throw new Error("Cancelled");
		const request = (method: string, params: unknown) =>
			process.rpc.request(method, params, {
				timeoutMs: method === "authenticate" ? 180_000 : startupTimeoutMs,
			});
		const init = await initializeAcp(request);
		authMethods = init.authMethods ?? [];
		loadSession = init.agentCapabilities?.loadSession ?? false;
		if (methodId) {
			const method = authMethods.find((item) => item.id === methodId);
			if (!method)
				throw new Error("Agent did not advertise this authentication method");
			if (method.type === "terminal")
				throw new Error(
					"Authenticate in a terminal on this host using the agent's setup command, then test the connection again.",
				);
			await request("authenticate", { methodId });
		}
		const session = decodeAcpSession(
			await request("session/new", { cwd, mcpServers: [] }),
		);
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			commandNotification,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, 250);
			}),
		]);
		if (timer) clearTimeout(timer);
		const inventory = acpSessionInventory(session);
		return {
			status: "ready",
			message: "Connected",
			authMethods,
			loadSession,
			models: inventory.models,
			modes: inventory.modes,
			currentModelId: inventory.currentModelId,
			currentModeId: inventory.currentModeId,
			commands,
		};
	} catch (error) {
		const authRequired =
			error instanceof AcpResponseError && error.code === -32000;
		return {
			status: authRequired ? "authentication-required" : "error",
			message: authRequired
				? "Sign in to this agent on this host."
				: Object.values(launch.env ?? {})
						.filter(Boolean)
						.reduce(
							(message, secret) => message.replaceAll(secret, "[redacted]"),
							error instanceof Error ? error.message : String(error),
						),
			authMethods,
			loadSession,
			models: [],
			modes: [],
			commands: [],
		};
	} finally {
		signal?.removeEventListener("abort", abort);
		process.close();
	}
};

export const makeAcpAgentStore = (
	directory: string,
	secrets: {
		get: (id: string) => Promise<string | null>;
		set: (id: string, value: string) => Promise<void>;
		remove: (id: string) => Promise<void>;
	},
	dependencies: {
		catalog?: typeof readCatalog;
		install?: typeof installCatalogAgent;
		probe?: typeof probeAcp;
		resolveExecutable?: (name: string) => Promise<string>;
	} = {},
) => {
	const registry = dependencies.catalog ?? readCatalog;
	const catalog = async (directory: string) => {
		const result = await registry(directory);
		return {
			...result,
			agents: [
				...result.agents.map((agent) => ({
					...agent,
					origin: "registry" as const,
				})),
				...COMMUNITY_ACP_AGENTS.filter(
					(agent) => !result.agents.some((entry) => entry.id === agent.id),
				).map((agent) => ({ ...agent, origin: "community" as const })),
			],
		};
	};
	const install = dependencies.install ?? installCatalogAgent;
	const probe = dependencies.probe ?? probeAcp;
	const file = join(directory, "agents.json");
	let tail: Promise<unknown> = Promise.resolve();
	const exclusive = <A>(operation: () => Promise<A>): Promise<A> => {
		const result = tail.then(operation, operation);
		tail = result.then(
			() => {},
			() => {},
		);
		return result;
	};
	let snapshot: Promise<readonly StoredDefinition[]> | undefined;
	const load = async (): Promise<readonly StoredDefinition[]> => {
		try {
			return Schema.decodeUnknownSync(Stored)(
				JSON.parse(await readFile(file, "utf8")),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	};
	const read = () =>
		(snapshot ??= load().catch((error) => {
			snapshot = undefined;
			throw error;
		}));
	const write = async (entries: readonly StoredDefinition[]) => {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const tmp = `${file}.${randomUUID()}.tmp`;
		await writeFile(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
		await rename(tmp, file);
		snapshot = Promise.resolve(entries);
	};
	const get = async (id: AcpProviderId) => {
		const found = (await read()).find((item) => item.id === id);
		if (!found)
			throw new Error(
				"This ACP agent was removed or is unavailable on this host.",
			);
		return found;
	};
	const launch = async (id: AcpProviderId): Promise<AcpLaunch> => {
		const entry = await get(id);
		if (!entry.enabled) throw new Error("This ACP agent is disabled.");
		const secret = await secrets.get(entry.credentialId ?? id);
		return {
			command: await (dependencies.resolveExecutable?.(entry.command) ??
				Promise.resolve(entry.command)),
			args: [...entry.args],
			env: secret ? Schema.decodeUnknownSync(Secrets)(JSON.parse(secret)) : {},
		};
	};
	const save = (input: AcpDefinitionInput) =>
		exclusive(async () => {
			if (
				!input.name.trim() ||
				!input.command.trim() ||
				[input.command, ...input.args].some((value) => value.includes("\0"))
			)
				throw new Error("Enter a name and executable without null characters.");
			if (
				input.env &&
				Object.keys(input.env).some(
					(key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key),
				)
			)
				throw new Error("Invalid environment variable name");
			const entries = await read();
			const old = input.id ? await get(input.id) : undefined;
			const id: AcpProviderId = input.id ?? `acp-${randomUUID()}`;
			const credentialId = input.env
				? `${id}:${randomUUID()}`
				: old?.credentialId;
			const revision = randomUUID();
			const changed =
				!old ||
				input.command !== old.command ||
				JSON.stringify(input.args) !== JSON.stringify(old.args) ||
				input.env !== undefined;
			const definition: StoredDefinition = {
				...old,
				credentialId,
				revision,
				id,
				name: input.name.trim(),
				command: input.command,
				args: [...input.args],
				enabled: input.enabled,
				envKeys: input.env ? Object.keys(input.env) : (old?.envKeys ?? []),
				probe: changed ? undefined : old?.probe,
			};
			if (input.env && credentialId)
				await secrets.set(credentialId, JSON.stringify(input.env));
			await write([...entries.filter((item) => item.id !== id), definition]);
			return publicDefinition(definition);
		});
	const test = async (
		id: AcpProviderId,
		methodId?: string,
		onStderr?: (text: string) => void,
		signal?: AbortSignal,
	) => {
		const snapshot = await get(id);
		const result = await probe(
			await launch(id),
			directory,
			methodId,
			onStderr,
			undefined,
			signal,
		);
		if (signal?.aborted) throw new Error("Sign in cancelled");
		await exclusive(async () => {
			const entries = await read();
			await write(
				entries.map((item) =>
					item.id === id && item.revision === snapshot.revision
						? { ...item, probe: result }
						: item,
				),
			);
		});
		return result;
	};
	return {
		directory,
		list: async () => (await read()).map(publicDefinition),
		get: async (id: AcpProviderId) => publicDefinition(await get(id)),
		launch,
		save,
		test,
		duplicate: async (id: AcpProviderId) => {
			const entry = await get(id);
			const secret = await secrets.get(entry.credentialId ?? id);
			return save({
				name: `${entry.name} copy`,
				command: entry.command,
				args: entry.args,
				enabled: entry.enabled,
				env: secret
					? Schema.decodeUnknownSync(Secrets)(JSON.parse(secret))
					: {},
			});
		},
		remove: (id: AcpProviderId) =>
			exclusive(async () => {
				const entry = await get(id);
				await write((await read()).filter((item) => item.id !== id));
				await secrets.remove(entry.credentialId ?? id);
			}),
		catalog: async () =>
			(await catalog(directory)).agents.map((agent) => ({
				id: agent.id,
				name: agent.name,
				description: agent.description,
				version: agent.version,
				source: agent.repository?.startsWith("https://")
					? agent.repository
					: "https://agentclientprotocol.com/registry",
				...registryIcon(agent),
				compatible: distributionFor(agent) !== null,
				origin: agent.origin,
			})),
		install: (catalogId: string, existingId?: AcpProviderId) =>
			exclusive(async () => {
				const registry = await catalog(directory);
				const agent = registry.agents.find((item) => item.id === catalogId);
				if (!agent) throw new Error("Agent not found in the ACP catalog");
				const old = existingId ? await get(existingId) : undefined;
				if (old && old.catalogId !== catalogId)
					throw new Error(
						"Update must use this agent's original catalog entry",
					);
				const id: AcpProviderId = existingId ?? `acp-${randomUUID()}`;
				const destination = join(directory, "installations", id, randomUUID());
				const prepared = await install(
					agent,
					destination,
					fetch,
					dependencies.resolveExecutable,
				);
				if (old) {
					const saved = await secrets.get(old.credentialId ?? old.id);
					if (saved) {
						const env = {
							...Schema.decodeUnknownSync(Secrets)(JSON.parse(saved)),
						};
						delete env.npm_config_cache;
						delete env.UV_CACHE_DIR;
						prepared.env = { ...prepared.env, ...env };
					}
				}
				const result = await probe(
					prepared,
					directory,
					undefined,
					undefined,
					180_000,
				);
				if (result.status === "error") throw new Error(result.message);
				const credentialId = `${id}:${randomUUID()}`;
				const entry: StoredDefinition = {
					credentialId,
					revision: randomUUID(),
					id,
					name: old?.name ?? agent.name,
					command: prepared.command,
					args: prepared.args,
					enabled: old?.enabled ?? true,
					envKeys: Object.keys(prepared.env),
					catalogId,
					version: agent.version,
					...registryIcon(agent),
					probe: result,
				};
				await secrets.set(credentialId, JSON.stringify(prepared.env));
				await write([
					...(await read()).filter((item) => item.id !== id),
					entry,
				]);
				return publicDefinition(entry);
			}),
		availability: async (): Promise<AgentAvailability[]> =>
			(await read()).map((entry) => ({
				providerId: entry.id,
				displayName: entry.name,
				runtimeKind: "cli",
				runtimeAvailable: entry.enabled,
				cliInstalled: true,
				cliLoggedIn: entry.probe?.status === "ready",
				hasApiKey: false,
				status: !entry.enabled
					? "disabled"
					: entry.probe?.status === "error"
						? "error"
						: entry.probe?.status === "ready"
							? "ready"
							: "warning",
				authStatus:
					entry.probe?.status === "ready" ? "authenticated" : "unknown",
			})),
	};
};
export class AcpAgentService extends Context.Service<
	AcpAgentService,
	ReturnType<typeof makeAcpAgentStore>
>()("zuse/AcpAgentService") {}
export const AcpAgentServiceLive = Layer.effect(
	AcpAgentService,
	Effect.gen(function* () {
		const executor = yield* ChildProcessSpawner.ChildProcessSpawner;
		const paths = yield* AppPaths;
		const credentials = yield* CredentialsService;
		const runtime = yield* Effect.context<never>();
		const run = Effect.runPromiseWith(runtime);
		return makeAcpAgentStore(
			join(paths.userData, "acp"),
			{
				get: (id) => run(credentials.getIntegration("acp", id)),
				set: (id, value) => run(credentials.setIntegration("acp", id, value)),
				remove: (id) => run(credentials.removeIntegration("acp", id)),
			},
			{
				resolveExecutable: async (name) => {
					const command = await run(
						resolveCliPath(name).pipe(
							Effect.provideService(
								ChildProcessSpawner.ChildProcessSpawner,
								executor,
							),
						),
					);
					if (!command)
						throw new Error(
							`Executable ${name} not found on this host. Install it or configure an absolute path.`,
						);
					return command;
				},
			},
		);
	}),
);
export const acpOperation = <A>(
	operation: (
		service: ReturnType<typeof makeAcpAgentStore>,
		signal: AbortSignal,
	) => Promise<A>,
) =>
	Effect.flatMap(AcpAgentService, (service) =>
		Effect.tryPromise({
			try: (signal) => operation(service, signal),
			catch: (error) =>
				new AcpOperationError({
					message: error instanceof Error ? error.message : String(error),
				}),
		}),
	);
