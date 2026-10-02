export type RendererAccountSnapshot = Readonly<{
	/** Undefined until the existing auth boundary has reported its initial state. */
	subject: string | null | undefined;
	epoch: number;
}>;

/** One identity-change boundary for account-owned renderer state and async work. */
export const createRendererAccountState = () => {
	let current: RendererAccountSnapshot = { subject: undefined, epoch: 0 };
	const listeners = new Set<() => void>();
	return {
		snapshot: () => current,
		observe: (subject: string | null): void => {
			if (current.subject === subject) return;
			current = { subject, epoch: current.epoch + 1 };
			for (const listener of listeners) listener();
		},
		subscribe: (listener: () => void): (() => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
};

const account = createRendererAccountState();
export const rendererAccountSnapshot = account.snapshot;
export const observeRendererAccount = account.observe;
export const subscribeRendererAccount = account.subscribe;

export const assertRendererAccountCurrent = (
	expected: RendererAccountSnapshot,
): void => {
	if (expected !== rendererAccountSnapshot())
		throw new Error(
			"The connection account changed. Reconnect this environment.",
		);
};
