import {
	AgentItemId,
	AgentTurnId,
	type ProviderEventEnvelope,
	SessionId,
} from "@zuse/contracts";
import { Deferred, Effect, Ref, Stream } from "effect";
import { describe, expect, test } from "vitest";
import { makeConversationEventRuntime } from "../../src/conversation/core/conversation-event-runtime.ts";

describe("ConversationEventRuntime", () => {
	const options = (
		scope: import("effect").Scope.Scope,
		events: () => Stream.Stream<ProviderEventEnvelope>,
		settleTurn: (
			sessionId: SessionId,
			turnId: AgentTurnId,
			outcome: "completed" | "interrupted" | "error",
		) => Effect.Effect<void> = () => Effect.void,
	) => ({
		scope,
		events,
		providerId: () => Effect.succeed("claude" as const),
		setStatus: () => Effect.void,
		settleTurn,
		beginProviderTurn: (_sessionId: SessionId, turnId: AgentTurnId) =>
			Effect.succeed(turnId),
		setResume: () => Effect.void,
		setPermissionMode: () => Effect.void,
		publishGoal: () => Effect.void,
		publishApiActivity: () => Effect.void,
		reconcileQuestionResolution: () => Effect.succeed(false),
		ignoreError: () => false,
		isDuplicateToolUse: () => Effect.succeed(false),
		persist: () => Effect.void,
	});

	test("does not guess a terminal when an uncorrelated stream ends", async () => {
		const settlements = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const scope = yield* Effect.scope;
					const settled = yield* Ref.make(0);
					const runtime = yield* makeConversationEventRuntime(
						options(
							scope,
							() => Stream.empty,
							() => Ref.update(settled, (count) => count + 1),
						),
					);
					yield* runtime.start(SessionId.make("session-1"));
					yield* Effect.sleep(10);
					return yield* Ref.get(settled);
				}),
			),
		);

		expect(settlements).toBe(0);
	});

	test("replaces the previous subscription and releases it", async () => {
		let active = 0;
		let maximumActive = 0;
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const scope = yield* Effect.scope;
					const events = () =>
						Stream.scoped(
							Stream.fromEffect(
								Effect.acquireRelease(
									Effect.sync(() => {
										active += 1;
										maximumActive = Math.max(maximumActive, active);
									}),
									() => Effect.sync(() => (active -= 1)),
								),
							).pipe(Stream.drain, Stream.concat(Stream.never)),
						);
					const runtime = yield* makeConversationEventRuntime(
						options(scope, events),
					);
					const sessionId = SessionId.make("session-1");
					yield* runtime.start(sessionId);
					yield* Effect.sleep(1);
					yield* runtime.start(sessionId);
					yield* Effect.sleep(1);
					yield* runtime.interrupt(sessionId);
				}),
			),
		);

		expect(maximumActive).toBe(1);
		expect(active).toBe(0);
	});

	test("reconciles a restored session-scoped question before projection", async () => {
		const outcome = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const scope = yield* Effect.scope;
					const reconciled = yield* Deferred.make<void>();
					const persisted = yield* Ref.make(0);
					const activities = yield* Ref.make(0);
					const sessionId = SessionId.make("session-1");
					const itemId = AgentItemId.make("question-1");
					const runtime = yield* makeConversationEventRuntime({
						...options(scope, () =>
							Stream.make({
								scope: "session",
								event: {
									_tag: "UserQuestion",
									itemId,
									questions: [
										{ question: "Continue?", options: ["Yes", "No"] },
									],
								},
							}),
						),
						reconcileQuestionResolution: (actualSessionId, actualItemId) =>
							Effect.sync(() => {
								expect(actualSessionId).toBe(sessionId);
								expect(actualItemId).toBe(itemId);
							}).pipe(
								Effect.andThen(Deferred.succeed(reconciled, undefined)),
								Effect.as(true),
							),
						publishApiActivity: () =>
							Ref.update(activities, (count) => count + 1),
						persist: () => Ref.update(persisted, (count) => count + 1),
					});
					yield* runtime.start(sessionId);
					yield* Deferred.await(reconciled);
					yield* Effect.sleep(1);
					return {
						persisted: yield* Ref.get(persisted),
						activities: yield* Ref.get(activities),
					};
				}),
			),
		);

		expect(outcome).toEqual({ persisted: 0, activities: 0 });
	});

	const runProviderTurn = (
		resolveStart: (turnId: AgentTurnId) => AgentTurnId,
	) =>
		Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const scope = yield* Effect.scope;
					const providerTurn = AgentTurnId.make("turn_provider");
					const itemId = AgentItemId.make("message-1");
					const started = yield* Ref.make<ReadonlyArray<AgentTurnId>>([]);
					const persisted = yield* Ref.make<ReadonlyArray<AgentTurnId>>([]);
					const settled = yield* Ref.make<ReadonlyArray<AgentTurnId>>([]);
					const done = yield* Deferred.make<void>();
					const runtime = yield* makeConversationEventRuntime({
						...options(
							scope,
							() =>
								Stream.make<ReadonlyArray<ProviderEventEnvelope>>(
									{
										scope: "turn",
										turnId: providerTurn,
										event: { _tag: "ProviderTurnStarted" },
									},
									{
										scope: "turn",
										turnId: providerTurn,
										event: { _tag: "AssistantMessage", itemId, text: "done" },
									},
									{
										scope: "turn",
										turnId: providerTurn,
										event: { _tag: "Completed", reason: "ended" },
									},
								).pipe(
									Stream.concat(
										Stream.fromEffect(Deferred.succeed(done, undefined)).pipe(
											Stream.drain,
										),
									),
								),
							(_sessionId, turnId) =>
								Ref.update(settled, (turns) => [...turns, turnId]),
						),
						beginProviderTurn: (_sessionId, turnId) =>
							Ref.update(started, (turns) => [...turns, turnId]).pipe(
								Effect.as(resolveStart(turnId)),
							),
						persist: (_sessionId, turnId) =>
							Ref.update(persisted, (turns) => [...turns, turnId]),
					});
					yield* runtime.start(SessionId.make("session-1"));
					yield* Deferred.await(done);
					yield* Effect.sleep(1);
					return {
						started: yield* Ref.get(started),
						persisted: yield* Ref.get(persisted),
						settled: yield* Ref.get(settled),
					};
				}),
			),
		);

	test("durably starts and settles a turn the provider opened itself", async () => {
		const outcome = await runProviderTurn((turnId) => turnId);

		expect(outcome).toEqual({
			started: ["turn_provider"],
			persisted: ["turn_provider"],
			settled: ["turn_provider"],
		});
	});

	test("folds a provider turn into an application turn that won the race", async () => {
		const outcome = await runProviderTurn(() =>
			AgentTurnId.make("turn_application"),
		);

		// The application turn settles on its own terminal, not the provider's.
		expect(outcome).toEqual({
			started: ["turn_provider"],
			persisted: ["turn_application"],
			settled: [],
		});
	});
});
