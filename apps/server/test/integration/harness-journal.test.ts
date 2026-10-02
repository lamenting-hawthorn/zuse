import type { HarnessState } from "@zuse/agents/harness/state";
import { layer as sqliteLayer } from "@zuse/sqlite";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { makeHarnessJournal } from "../../src/harness/journal.ts";
import { Migration0061HarnessExecutions } from "../../src/persistence/migrations/0061_harness_executions.ts";

const state: HarnessState = {
	version: 1,
	rootId: "root",
	model: "chosen",
	requests: 3,
	agents: [
		{
			id: "root",
			name: "root",
			parentId: null,
			parentItemId: null,
			depth: 0,
			readOnly: false,
			history: [{ role: "user", content: "task" }],
			mailbox: [{ id: "message", text: "pending" }],
			status: "interrupted",
			turns: 2,
			summary: "",
			pendingCalls: [{ id: "edit", name: "edit", input: { path: "file" } }],
			completedDelivery: false,
			checkpoint: { covered: 1, summary: "summary" },
		},
	],
	tools: { "root:edit": { status: "completed", output: "edited" } },
};
it("persists authoritative checkpoints and rejects stale owners", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* Migration0061HarnessExecutions;
			const one = yield* makeHarnessJournal("root");
			const two = yield* makeHarnessJournal("root");
			yield* Effect.promise(async () => {
				expect(await one.load()).toBeNull();
				expect(await two.load()).toBeNull();
				await one.save(state);
				await expect(two.save(state)).rejects.toThrow("ownership changed");
				const loaded = await two.load();
				expect(loaded).toEqual(state);
				await two.save({ ...state, requests: 4 });
				await expect(one.save(state)).rejects.toThrow("ownership changed");
				expect((await one.load())?.requests).toBe(4);
			});
		}).pipe(Effect.provide(sqliteLayer({ filename: ":memory:" }))),
	);
});
