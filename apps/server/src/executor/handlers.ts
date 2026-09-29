import { ExecutorError, MemoizeRpcs } from "@zuse/contracts";
import { Effect, Layer, Semaphore } from "effect";
import { CredentialsService } from "../provider/services/credentials-service.ts";
import {
	disconnectedExecutorState,
	executorAddress,
	executorCatalog,
} from "./client.ts";
import {
	EXECUTOR_ACCOUNT,
	EXECUTOR_INTEGRATION,
	executorUnavailableState,
	readExecutorProfile,
} from "./service.ts";

const catalog = Effect.fn("Executor.catalog")(function* () {
	const profile = yield* readExecutorProfile();
	if (!profile) return disconnectedExecutorState();
	return yield* Effect.tryPromise({
		try: (signal) => executorCatalog(profile, signal),
		catch: (cause) =>
			new ExecutorError({
				reason:
					cause instanceof Error ? cause.message : "Could not reach Executor.",
			}),
	}).pipe(
		Effect.catch((error) =>
			Effect.succeed(executorUnavailableState(profile, error.reason)),
		),
	);
});
// One lane for config changes from multiple windows; a failed change never poisons the lane.
const lock = Semaphore.makeUnsafe(1);
const error = () =>
	new ExecutorError({
		reason:
			"Could not update Executor. Check the service URL and personal API key, then retry.",
	});
export const executeExecutor = (
	command: import("@zuse/contracts").ExecutorCommand,
) =>
	Effect.gen(function* () {
		const credentials = yield* CredentialsService;
		if (command._tag === "disconnect") {
			yield* credentials.removeIntegration(
				EXECUTOR_INTEGRATION,
				EXECUTOR_ACCOUNT,
			);
			return disconnectedExecutorState();
		}
		if (command._tag === "connect") {
			const url = yield* Effect.try({
				try: () => executorAddress(command.url).url,
				catch: error,
			});
			const token = command.token.trim();
			if (!token || /[\r\n\0]/.test(token)) return yield* error();
			const profile = { url, token, enabled: true, toolkit: null };
			// Validate before replacing a working connection. Only the secret store holds the key.
			const state = yield* Effect.tryPromise({
				try: (signal) => executorCatalog(profile, signal),
				catch: error,
			});
			yield* credentials.setIntegration(
				EXECUTOR_INTEGRATION,
				EXECUTOR_ACCOUNT,
				JSON.stringify(profile),
			);
			return state;
		}
		const profile = yield* readExecutorProfile();
		if (!profile)
			return yield* new ExecutorError({ reason: "Connect Executor first." });
		if (
			command.toolkit !== null &&
			!/^[a-z0-9][a-z0-9-]{0,62}$/.test(command.toolkit)
		)
			return yield* error();
		const updated = {
			...profile,
			enabled: command.enabled,
			toolkit: command.toolkit,
		};
		// Disabling remains possible offline. Enabling/changing a toolkit must verify it exists.
		if (command.enabled) {
			const state = yield* Effect.tryPromise({
				try: (signal) => executorCatalog(updated, signal),
				catch: error,
			});
			if (
				command.toolkit !== null &&
				!state.toolkits.some((t) => t.slug === command.toolkit)
			)
				return yield* new ExecutorError({
					reason: "That toolkit is unavailable. Refresh and choose another.",
				});
		}
		yield* credentials.setIntegration(
			EXECUTOR_INTEGRATION,
			EXECUTOR_ACCOUNT,
			JSON.stringify(updated),
		);
		return yield* catalog();
	}).pipe(
		lock.withPermits(1),
		Effect.mapError((cause) =>
			cause instanceof ExecutorError ? cause : error(),
		),
	);

export const ExecutorHandlersLayer = Layer.mergeAll(
	MemoizeRpcs.toLayerHandler("executor.state", () =>
		catalog().pipe(Effect.mapError(error)),
	),
	MemoizeRpcs.toLayerHandler("executor.execute", executeExecutor),
);
