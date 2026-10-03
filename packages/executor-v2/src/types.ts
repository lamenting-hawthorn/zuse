import type { DurableObjectStorage } from "@cloudflare/workers-types";

/** Plain values only: the upstream Effect runtime stays inside the bundled adapter. */
export interface EnginePlugin {
	readonly id: string;
	readonly name: string;
	readonly endpoint: string;
	readonly auth: "none" | "oauth";
	readonly scopes: readonly string[];
}
export interface EngineOptions {
	readonly storage: DurableObjectStorage;
	readonly encryptionKey: string;
	readonly credentialScope: string;
	readonly plugins: readonly EnginePlugin[];
	readonly fetch: typeof fetch;
}
export interface EngineConnection {
	readonly app: string;
	readonly profile: string;
	readonly connection?: string;
	readonly account?: string;
}
export interface PluginEngine {
	prepare(
		owner: string,
		subject: string,
		id: string,
		pluginId: string,
	): Promise<EngineConnection>;
	start(
		owner: string,
		ref: EngineConnection,
		label: string,
		redirectUri: string,
	): Promise<string>;
	complete(
		owner: string,
		ref: EngineConnection,
		callbackUrl: string,
	): Promise<EngineConnection>;
	remove(owner: string, id: string, ref?: EngineConnection): Promise<void>;
	list(
		owner: string,
		ref: EngineConnection,
	): Promise<readonly { name: string; description: string }[]>;
	schema(owner: string, ref: EngineConnection, tool: string): Promise<unknown>;
	call(
		owner: string,
		ref: EngineConnection,
		tool: string,
		input: unknown,
	): Promise<unknown>;
	close(): Promise<void>;
}
