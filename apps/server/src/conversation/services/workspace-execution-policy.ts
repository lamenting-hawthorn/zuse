import type { SessionId, WorkspaceActor } from "@zuse/contracts";
import { Context, Deferred, Effect, Layer } from "effect";

export type WorkspaceExecutionAuthorizer = (
	sessionId: SessionId,
	actor: WorkspaceActor | undefined,
) => Effect.Effect<boolean>;

/** One runtime-wide policy, independent of disposable client connections. */
export const WorkspaceExecutionPolicy = Context.Reference<{
	readonly authorize: WorkspaceExecutionAuthorizer;
	readonly bind: (
		authorize: WorkspaceExecutionAuthorizer,
	) => Effect.Effect<void>;
}>("zuse/conversation/WorkspaceExecutionPolicy", {
	defaultValue: () => ({
		authorize: (_sessionId, actor) => Effect.succeed(actor === undefined),
		bind: () => Effect.die("Workspace execution policy was not initialized"),
	}),
});

/** Cloud recovery waits until bootstrap has established ownership and credentials. */
export const PendingWorkspaceExecutionPolicy = Layer.effect(
	WorkspaceExecutionPolicy,
	Effect.gen(function* () {
		const policy = yield* Deferred.make<WorkspaceExecutionAuthorizer>();
		return {
			authorize: (sessionId, actor) =>
				Effect.flatMap(Deferred.await(policy), (authorize) =>
					authorize(sessionId, actor),
				),
			bind: (authorize) =>
				Deferred.succeed(policy, authorize).pipe(Effect.asVoid),
		};
	}),
);
