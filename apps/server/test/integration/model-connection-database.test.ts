import { layer as sqliteLayer } from "@zuse/sqlite";
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { expect, it } from "vitest";
import { modelConnectionDatabase } from "../../src/harness/connection-database.ts";
import { Migration0062ModelConnections } from "../../src/persistence/migrations/0062_model_connections.ts";
import type { CredentialsServiceShape } from "../../src/provider/services/credentials-service.ts";

it("migrates vault records encrypted, preserves unrelated credentials, and rejects swapped ciphertext", async () => {
	const values = new Map([["zuse-chatgpt-connections:a", "token-secret"]]);
	const noop = () => Effect.void;
	const legacy: CredentialsServiceShape = {
		getProviderCredential: () => Effect.succeed(null),
		setProviderCredential: noop,
		get: () => Effect.succeed(null),
		set: noop,
		remove: noop,
		listConfigured: () => Effect.succeed([]),
		setBrowser: noop,
		getBrowser: () => Effect.succeed(null),
		removeBrowser: noop,
		listBrowser: () => Effect.succeed([]),
		getWorkosSession: () => Effect.succeed(null),
		setWorkosSession: noop,
		removeWorkosSession: noop,
		getMcpOauth: () => Effect.succeed(null),
		setMcpOauth: noop,
		removeMcpOauth: noop,
		getIntegration: (n, id) => Effect.succeed(values.get(`${n}:${id}`) ?? null),
		setIntegration: (n, id, v) =>
			Effect.sync(() => {
				values.set(`${n}:${id}`, v);
			}),
		removeIntegration: (n, id) =>
			Effect.sync(() => {
				values.delete(`${n}:${id}`);
			}),
		listIntegrationAccounts: (n) =>
			Effect.succeed(
				[...values.keys()]
					.filter((k) => k.startsWith(`${n}:`))
					.map((k) => k.slice(n.length + 1)),
			),
	};
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* Migration0062ModelConnections;
			const sql = yield* SqlClient.SqlClient;
			const credentials = yield* modelConnectionDatabase(legacy, async () =>
				Buffer.alloc(32, 7),
			);
			expect(
				yield* credentials.getIntegration("zuse-chatgpt-connections", "a"),
			).toBe("token-secret");
			expect(values.size).toBe(0);
			const rows = yield* sql<{
				envelope: string;
			}>`SELECT envelope FROM model_connection_secrets`;
			expect(rows[0]?.envelope).not.toContain("token-secret");
			yield* sql`INSERT INTO model_connection_secrets(namespace,connection_id,envelope,updated_at) VALUES('zuse-chatgpt-connections','b',${rows[0]?.envelope ?? ""},0)`;
			const swapped = yield* Effect.result(
				credentials.getIntegration("zuse-chatgpt-connections", "b"),
			);
			expect(swapped._tag).toBe("Failure");
			yield* credentials.setIntegration("other", "untouched", "other-secret");
			expect(values.get("other:untouched")).toBe("other-secret");
			yield* credentials.removeIntegration("zuse-chatgpt-connections", "a");
			values.set("zuse-chatgpt-connections:a", "old-refresh-token");
			expect(
				yield* credentials.getIntegration("zuse-chatgpt-connections", "a"),
			).toBeNull();
		}).pipe(Effect.provide(sqliteLayer({ filename: ":memory:" }))),
	);
});
