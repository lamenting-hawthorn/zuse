import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { expect, it } from "vitest";

const connectionString = process.env.ZUSE_TEST_DATABASE_URL;
const migration = (name: string) =>
	readFile(
		new URL(`../../drizzle/migrations/${name}.sql`, import.meta.url),
		"utf8",
	);

it.skipIf(!connectionString).each(["main", "organizations"])(
	"reconciles %s schemas without replacing existing records",
	async (source) => {
		const db = new Client({ connectionString });
		await db.connect();
		const schema = `upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
		try {
			await db.query(`CREATE SCHEMA ${schema}`);
			await db.query(`SET search_path=${schema}`);
			await db.query(
				"CREATE TABLE api_environments (environment_id text PRIMARY KEY)",
			);
			if (source === "main") {
				await db.query(await migration("0029_model_connections"));
				await db.query(
					"INSERT INTO api_model_connections VALUES ('personal', 'supergrok', 'active', 'connection', 'original-ciphertext')",
				);
			} else {
				await db.query(await migration("0029_environment_sharing_audience"));
				await db.query(await migration("0030_workspace_settings"));
				await db.query(
					`INSERT INTO api_workspace_settings VALUES ('organization:test', 2, '{"scripts": []}')`,
				);
			}
			for (let restart = 0; restart < 2; restart++)
				await db.query(
					await migration("0033_reconcile_workspace_and_model_schemas"),
				);
			const connections = await db.query(
				"SELECT envelope FROM api_model_connections",
			);
			const settings = await db.query(
				"SELECT owner_id, revision FROM api_workspace_settings",
			);
			expect(connections.rows).toEqual(
				source === "main" ? [{ envelope: "original-ciphertext" }] : [],
			);
			expect(settings.rows).toEqual(
				source === "organizations"
					? [{ owner_id: "organization:test", revision: 2 }]
					: [],
			);
			await db.query("SELECT sharing_audience FROM api_environments");
			await db.query("SELECT token FROM api_model_connection_leases");
		} finally {
			await db.query(`DROP SCHEMA ${schema} CASCADE`);
			await db.end();
		}
	},
);
