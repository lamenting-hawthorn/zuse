import { Effect, ManagedRuntime } from "effect";
import { expect, it, vi } from "vitest";
import { ApiStore, ApiStoreMemory } from "../../src/store.ts";

it("bounds stalled organization mutations and releases the next caller", async () => {
	vi.useFakeTimers();
	const runtime = ManagedRuntime.make(ApiStoreMemory);
	let interrupted = false;
	let failure: unknown;
	try {
		const store = await runtime.runPromise(ApiStore);
		const pending = runtime
			.runPromise(
				store.withOrganizationLock(
					"org",
					Effect.never.pipe(
						Effect.onInterrupt(() =>
							Effect.sync(() => {
								interrupted = true;
							}),
						),
					),
				),
			)
			.catch((error: unknown) => {
				failure = error;
			});
		await vi.advanceTimersByTimeAsync(60_001);
		expect(failure).toMatchObject({
			code: "organization_operation_timeout",
			status: 503,
		});
		expect(interrupted).toBe(true);
		expect(
			await runtime.runPromise(
				store.withOrganizationLock("org", Effect.succeed("next")),
			),
		).toBe("next");
		await pending;
	} finally {
		await runtime.dispose();
		vi.useRealTimers();
	}
});
