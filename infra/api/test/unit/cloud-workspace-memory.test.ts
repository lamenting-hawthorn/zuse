import {
	SandboxProviderError,
	SandboxProviders,
} from "@zuse/sandbox-providers";
import { SandboxProvidersFake } from "@zuse/sandbox-providers/testing";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { readCloudMemory } from "../../src/cloud-workspace-memory.ts";

test.each([
	"missing",
	"unresponsive",
])("%s diagnostics do not invent an OOM or block recovery", async (mode) => {
	const result = await Effect.runPromise(
		Effect.gen(function* () {
			const adapter = yield* (yield* SandboxProviders).get("fake");
			return yield* readCloudMemory(
				{
					...adapter,
					readTextFile: () =>
						mode === "missing"
							? Effect.fail(new SandboxProviderError({ code: "not-found" }))
							: Effect.never,
				},
				"sandbox",
				1,
			);
		}).pipe(Effect.provide(SandboxProvidersFake)),
	);
	expect(result).toEqual({ memory: null, oom: false });
}, 5000);
