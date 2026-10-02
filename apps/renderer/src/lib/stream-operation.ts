import { Effect, Fiber, Stream } from "effect";

export interface StreamOperation {
	readonly done: Promise<void>;
	readonly cancel: () => void;
}

/**
 * The sole renderer execution primitive for bounded, user-launched streams
 * such as OAuth, CLI install/update, and credential transfer progress. Passive
 * synchronization belongs to ClientBus resource drivers instead.
 */
export const runStreamOperation = <Value, Error>(
	stream: Stream.Stream<Value, Error>,
	onValue: (value: Value) => void | Promise<void>,
): StreamOperation => {
	const fiber = Effect.runFork(
		Stream.runForEach(stream, (value) =>
			Effect.promise(() => Promise.resolve(onValue(value))),
		),
	);
	return {
		done: Effect.runPromise(Fiber.join(fiber)),
		cancel: () => {
			void Effect.runPromise(Fiber.interrupt(fiber));
		},
	};
};

/** Owns one attempt, including async client acquisition and terminal-state cleanup. */
export class StreamOperationOwner {
	private attempt: AbortController | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	async run<Value, Error>(
		load: () => Promise<Stream.Stream<Value, Error>>,
		onValue: (value: Value) => void | Promise<void>,
		onError: (error: unknown) => void,
	): Promise<void> {
		this.cancel();
		const attempt = new AbortController();
		this.attempt = attempt;
		try {
			const stream = await load();
			if (attempt.signal.aborted) return;
			const operation = runStreamOperation(stream, async (value) => {
				if (!attempt.signal.aborted) await onValue(value);
			});
			const cancel = () => operation.cancel();
			attempt.signal.addEventListener("abort", cancel, { once: true });
			try {
				await operation.done;
			} finally {
				attempt.signal.removeEventListener("abort", cancel);
			}
		} catch (error) {
			if (!attempt.signal.aborted) onError(error);
		} finally {
			if (this.attempt === attempt) this.attempt = undefined;
		}
	}
	resetAfter(callback: () => void, ms = 4000) {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			callback();
		}, ms);
	}
	cancel() {
		this.attempt?.abort();
		this.attempt = undefined;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}
}
