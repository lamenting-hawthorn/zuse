import { readFile } from "node:fs/promises";
import { PgClient } from "@effect/sql-pg";
import { CloudAuthStatus } from "@zuse/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Pool } from "pg";
import { expect, test } from "vitest";
import {
	CloudWorkspaceStore,
	CloudWorkspaceStorePg,
} from "../../src/cloud-workspace-store.ts";

const url = process.env.ZUSE_TEST_POSTGRES_URL;
test.skipIf(!url)(
	"auth status survives restart, fences stale writes and preserves historical evidence",
	async () => {
		const schema = `auth_status_${crypto.randomUUID().replaceAll("-", "")}`;
		const admin = new Pool({ connectionString: url });
		await admin.query(`CREATE SCHEMA ${schema}`);
		const pool = new Pool({
			connectionString: url,
			options: `-c search_path=${schema}`,
		});
		const layer = CloudWorkspaceStorePg.pipe(
			Layer.provideMerge(
				PgClient.layerFrom(
					PgClient.fromPool({ acquire: Effect.succeed(pool) }),
				),
			),
		);
		let runtime = ManagedRuntime.make(layer);
		const migrate = async (name: string) =>
			pool.query(
				await readFile(
					new URL(`../../drizzle/migrations/${name}.sql`, import.meta.url),
					"utf8",
				),
			);
		try {
			await migrate("0017_cloud_codex_auth_broker");
			await migrate("0031_cloud_auth_status");
			let store = await runtime.runPromise(CloudWorkspaceStore);
			await runtime.runPromise(
				store.claimCloudAuthAuthority({
					accountId: "account",
					provider: "e2b",
					candidateStorageIncarnationId: "disk",
					toolchainVersion: "test",
					leaseOwner: "worker",
					nowMs: 1,
					leaseExpiresAtMs: 2,
				}),
			);
			const locator = await runtime.runPromise(
				store.completeCloudAuthAuthorityProvisioning({
					accountId: "account",
					providerSandboxId: "sandbox",
					storageIncarnationId: "disk",
					toolchainVersion: "test",
					leaseOwner: "worker",
					nowMs: 2,
				}),
			);
			const status = new CloudAuthStatus({
				authorityState: "ready",
				providers: [{ providerId: "grok", state: "connected" }],
				updatedAt: 3,
			});
			await runtime.runPromise(
				store.saveCloudAuthStatus({
					accountId: "account",
					expectedRevision: locator?.revision ?? -1,
					status,
				}),
			);
			await runtime.dispose();
			runtime = ManagedRuntime.make(layer);
			store = await runtime.runPromise(CloudWorkspaceStore);
			expect(
				(await runtime.runPromise(store.getCloudAuthAuthority("account")))
					?.status,
			).toEqual(status);
			expect(
				await runtime.runPromise(store.getCloudAuthAuthority("other")),
			).toBeNull();
			await runtime.runPromise(
				store.saveCloudAuthStatus({
					accountId: "account",
					expectedRevision: locator?.revision ?? -1,
					status: new CloudAuthStatus({ ...status, providers: [] }),
				}),
			);
			expect(
				(await runtime.runPromise(store.getCloudAuthAuthority("account")))
					?.status,
			).toEqual(status);
			await runtime.runPromise(
				store.claimCloudAuthAuthority({
					accountId: "account",
					provider: "e2b",
					candidateStorageIncarnationId: "replacement-disk",
					toolchainVersion: "test",
					leaseOwner: "worker",
					nowMs: 4,
					leaseExpiresAtMs: 5,
					replaceReady: true,
				}),
			);
			expect(
				(await runtime.runPromise(store.getCloudAuthAuthority("account")))
					?.status,
			).toBeUndefined();
			await pool.query(
				"CREATE TABLE api_cloud_workspace_usage (event_id text, kind text, quantity bigint, CONSTRAINT api_cloud_usage_kind_check CHECK (kind IN ('runtime-seconds', 'pause', 'resume', 'snapshot-bytes', 'storage-byte-seconds', 'archive', 'restore', 'delete')))",
			);
			await pool.query(
				"INSERT INTO api_cloud_workspace_usage VALUES ('original-id','runtime-seconds',364702),('pause-id','pause',1)",
			);
			await migrate("0032_classify_legacy_lifecycle_usage");
			expect(
				(
					await pool.query(
						"SELECT * FROM api_cloud_workspace_usage ORDER BY event_id",
					)
				).rows,
			).toEqual([
				{
					event_id: "original-id",
					kind: "lifecycle-elapsed-seconds",
					quantity: "364702",
				},
				{ event_id: "pause-id", kind: "pause", quantity: "1" },
			]);
		} finally {
			await runtime.dispose();
			await pool.end();
			await admin.query(`DROP SCHEMA ${schema} CASCADE`);
			await admin.end();
		}
	},
);
