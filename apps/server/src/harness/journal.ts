import {
	decodeHarnessState,
	type HarnessState,
} from "@zuse/agents/harness/state";
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

/** Each live engine owns a revision cursor. A stale writer cannot replace a newer checkpoint. */
export const makeHarnessJournal = (rootId: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		let revision: number | null = null;
		return {
			load: async (): Promise<HarnessState | null> => {
				const rows = await Effect.runPromise(
					sql<{
						revision: number;
						state_json: string;
					}>`SELECT revision,state_json FROM harness_executions WHERE root_id=${rootId}`,
				);
				const row = rows[0];
				revision = row?.revision ?? 0;
				if (!row) return null;
				const state = decodeHarnessState(JSON.parse(row.state_json));
				if (state.rootId !== rootId)
					throw new Error("Harness journal identity mismatch");
				return state;
			},
			save: async (state: HarnessState): Promise<void> => {
				if (revision === null || state.rootId !== rootId)
					throw new Error("Harness journal must be loaded before saving");
				const previous = revision;
				const next = previous + 1;
				const encoded = JSON.stringify(state);
				const updated = new Date().toISOString();
				const rows = await Effect.runPromise(
					previous === 0
						? sql<{
								revision: number;
							}>`INSERT INTO harness_executions(root_id,revision,state_json,updated_at) VALUES(${rootId},${next},${encoded},${updated}) ON CONFLICT(root_id) DO NOTHING RETURNING revision`
						: sql<{
								revision: number;
							}>`UPDATE harness_executions SET revision=${next},state_json=${encoded},updated_at=${updated} WHERE root_id=${rootId} AND revision=${previous} RETURNING revision`,
				);
				if (rows.length !== 1)
					throw new Error(
						"Harness journal ownership changed. Stop this execution and reload.",
					);
				revision = next;
			},
		};
	});
