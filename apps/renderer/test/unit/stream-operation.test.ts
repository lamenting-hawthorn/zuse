import { Effect, Stream } from "effect";
import { expect, it, vi } from "vitest";
import { StreamOperationOwner } from "../../src/lib/stream-operation.ts";

it("fences a canceled client acquisition even when a new attempt starts", async () => {
	const owner = new StreamOperationOwner();
	let resolve!: (stream: Stream.Stream<number>) => void;
	const pending = new Promise<Stream.Stream<number>>((yes) => {
		resolve = yes;
	});
	const values: number[] = [];
	const error = vi.fn();
	const first = owner.run(
		() => pending,
		(value) => {
			values.push(value);
		},
		error,
	);
	await owner.run(
		async () => Stream.make(2),
		(value) => {
			values.push(value);
		},
		error,
	);
	resolve(Stream.make(1));
	await first;
	expect(values).toEqual([2]);
	expect(error).not.toHaveBeenCalled();
});
it("cancel interrupts the active stream and clears stale terminal resets", async () => {
	const owner = new StreamOperationOwner();
	let started!: () => void;
	const ready = new Promise<void>((yes) => {
		started = yes;
	});
	let released = false;
	const done = owner.run(
		async () =>
			Stream.fromEffect(
				Effect.gen(function* () {
					started();
					yield* Effect.never;
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							released = true;
						}),
					),
				),
			),
		() => {},
		() => {},
	);
	await ready;
	owner.cancel();
	await done;
	expect(released).toBe(true);
	vi.useFakeTimers();
	try {
		const reset = vi.fn();
		owner.resetAfter(reset);
		owner.cancel();
		vi.runAllTimers();
		expect(reset).not.toHaveBeenCalled();
	} finally {
		vi.useRealTimers();
	}
});
