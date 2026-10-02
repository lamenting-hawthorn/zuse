import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { openApiString, sealApiString } from "./api-sealing.ts";
import { ApiConfiguration } from "./config.ts";

export interface ConnectionStore {
	acquire(account: string, provider: string, token: string): Promise<boolean>;
	release(account: string, provider: string, token: string): Promise<void>;
	read(
		account: string,
		provider: string,
		token: string,
		kind: string,
		id: string,
	): Promise<string | null>;
	list(
		account: string,
		provider: string,
		token: string,
		kind: string,
	): Promise<string[]>;
	write(
		account: string,
		provider: string,
		token: string,
		kind: string,
		id: string,
		value: string | null,
	): Promise<void>;
	removeAccount(account: string): Promise<void>;
}
export class ModelConnectionStore extends Context.Service<
	ModelConnectionStore,
	ConnectionStore
>()("api/ModelConnectionStore") {}
const aad = (account: string, provider: string, kind: string, id: string) =>
	JSON.stringify(["model-connection-v1", account, provider, kind, id]);
/** One bounded, fenced lease per account/provider serializes refresh across machines. */
export const ModelConnectionStoreLive = Layer.effect(
	ModelConnectionStore,
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const config = yield* ApiConfiguration;
		const cipher = (action: Effect.Effect<string, unknown, ApiConfiguration>) =>
			Effect.runPromise(
				action.pipe(Effect.provideService(ApiConfiguration, config)),
			);
		const leased = <A>(
			account: string,
			provider: string,
			token: string,
			operation: Effect.Effect<A, unknown>,
		) =>
			Effect.runPromise(
				sql.withTransaction(
					Effect.gen(function* () {
						const leases =
							yield* sql`SELECT token FROM api_model_connection_leases WHERE account_id=${account} AND provider=${provider} AND token=${token} AND expires_at_ms > extract(epoch FROM clock_timestamp()) * 1000 FOR UPDATE`;
						if (leases.length !== 1)
							return yield* Effect.fail(new Error("connection_lease_lost"));
						return yield* operation;
					}),
				),
			);
		return {
			acquire: (account, provider, token) =>
				Effect.runPromise(
					sql`INSERT INTO api_model_connection_leases(account_id,provider,token,expires_at_ms) VALUES(${account},${provider},${token},extract(epoch FROM clock_timestamp()) * 1000 + 120000) ON CONFLICT(account_id,provider) DO UPDATE SET token=excluded.token,expires_at_ms=excluded.expires_at_ms WHERE api_model_connection_leases.expires_at_ms <= extract(epoch FROM clock_timestamp()) * 1000 RETURNING token`,
				).then((rows) => rows.length === 1),
			release: (account, provider, token) =>
				Effect.runPromise(
					sql`DELETE FROM api_model_connection_leases WHERE account_id=${account} AND provider=${provider} AND token=${token}`,
				).then(() => undefined),
			read: (account, provider, token, kind, id) =>
				leased(
					account,
					provider,
					token,
					Effect.gen(function* () {
						const rows = yield* sql<{
							envelope: string;
						}>`SELECT envelope FROM api_model_connections WHERE account_id=${account} AND provider=${provider} AND kind=${kind} AND connection_id=${id}`;
						const row = rows[0];
						return row
							? yield* Effect.promise(() =>
									cipher(
										openApiString(
											aad(account, provider, kind, id),
											row.envelope,
										),
									),
								)
							: null;
					}),
				),
			list: (account, provider, token, kind) =>
				leased(
					account,
					provider,
					token,
					Effect.gen(function* () {
						const rows = yield* sql<{
							connection_id: string;
							envelope: string;
						}>`SELECT connection_id,envelope FROM api_model_connections WHERE account_id=${account} AND provider=${provider} AND kind=${kind} ORDER BY connection_id`;
						return yield* Effect.promise(() =>
							Promise.all(
								rows.map((row) =>
									cipher(
										openApiString(
											aad(account, provider, kind, row.connection_id),
											row.envelope,
										),
									),
								),
							),
						);
					}),
				),
			write: async (account, provider, token, kind, id, value) => {
				const envelope =
					value === null
						? null
						: await cipher(
								sealApiString(aad(account, provider, kind, id), value),
							);
				await leased(
					account,
					provider,
					token,
					Effect.gen(function* () {
						if (envelope === null) {
							yield* sql`DELETE FROM api_model_connections WHERE account_id=${account} AND provider=${provider} AND kind=${kind} AND connection_id=${id}`;
							return;
						}
						const count = yield* sql<{
							count: string;
						}>`SELECT count(*) AS count FROM api_model_connections WHERE account_id=${account} AND provider=${provider}`;
						const existing =
							yield* sql`SELECT connection_id FROM api_model_connections WHERE account_id=${account} AND provider=${provider} AND kind=${kind} AND connection_id=${id}`;
						if (Number(count[0]?.count ?? 0) >= 128 && !existing.length)
							return yield* Effect.fail(new Error("connection_capacity"));
						yield* sql`INSERT INTO api_model_connections(account_id,provider,kind,connection_id,envelope) VALUES(${account},${provider},${kind},${id},${envelope}) ON CONFLICT(account_id,provider,kind,connection_id) DO UPDATE SET envelope=excluded.envelope`;
					}),
				);
			},
			removeAccount: async (account) => {
				await Effect.runPromise(
					sql.withTransaction(
						Effect.gen(function* () {
							yield* sql`DELETE FROM api_model_connections WHERE account_id=${account}`;
							yield* sql`DELETE FROM api_model_connection_leases WHERE account_id=${account}`;
						}),
					),
				);
			},
		} satisfies ConnectionStore;
	}),
);
