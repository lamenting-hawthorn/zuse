import type { DurableObjectState } from "@cloudflare/workers-types";
import {
	type PluginVaultEnv,
	PluginVault as Vault,
} from "../../src/plugin-vault.ts";

/** Test-only storage inspection. This class is never exported by the production Worker. */
export class PluginVault extends Vault {
	constructor(
		private readonly testState: DurableObjectState,
		env: PluginVaultEnv,
	) {
		super(testState, env);
	}
	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/__test/forget-reference") {
			await this.testState.storage.delete(
				`engine:alice:${url.searchParams.get("id")}`,
			);
			return new Response(null, { status: 204 });
		}
		if (new URL(request.url).pathname === "/__test/storage") {
			const tables = this.testState.storage.sql
				.exec<{ name: string }>(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%'",
				)
				.toArray();
			const rows = Object.fromEntries(
				tables.map(({ name }) => [
					name,
					this.testState.storage.sql
						.exec(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
						.toArray(),
				]),
			);
			return Response.json({
				rows,
				kv: Object.fromEntries(await this.testState.storage.list()),
			});
		}
		return super.fetch(request);
	}
}
export default {
	fetch() {
		return new Response("test");
	},
};
