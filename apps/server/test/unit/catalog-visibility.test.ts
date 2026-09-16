import {
	Chat,
	ChatId,
	type ChatSummaryChange,
	FolderId,
	Session,
	SessionId,
	type SessionSummaryChange,
} from "@zuse/contracts";
import { Deferred, Effect, Fiber, Stream, SubscriptionRef } from "effect";
import { expect, it } from "vitest";
import {
	CatalogVisibility,
	CatalogVisibilityChanges,
	filterChatCatalog,
	filterSessionCatalog,
	withCatalogChanges,
} from "../../src/collaboration/services/catalog-visibility.ts";

const projectId = FolderId.make("project");
const now = new Date(0);
const chat = (id: string) =>
	Chat.make({
		id: ChatId.make(id),
		projectId,
		title: id,
		titleProvenance: "manual",
		worktreeId: null,
		activeSessionId: null,
		originSessionId: null,
		archivedAt: null,
		lastMessageAt: null,
		lastReadAt: null,
		createdAt: now,
		updatedAt: now,
	});
const session = (id: string, chatId = "shared") =>
	Session.make({
		id: SessionId.make(id),
		chatId: ChatId.make(chatId),
		projectId,
		title: id,
		titleProvenance: "manual",
		providerId: "codex",
		model: "test",
		status: "idle",
		archivedAt: null,
		cursor: null,
		resumeStrategy: "none",
		runtimeMode: "approval-required",
		worktreeId: null,
		forkedFromSessionId: null,
		forkedFromMessageId: null,
		permissionMode: "default",
		toolSearch: false,
		createdAt: now,
		updatedAt: now,
	});
const scope = (id: string): CatalogVisibility["Service"] => ({
	chats: new Set([ChatId.make(id)]),
	projects: new Set([projectId]),
});

it("filters chat snapshots and updates without changing the host feed", async () => {
	const frames: ChatSummaryChange[] = [
		{ _tag: "snapshot", chats: [chat("shared"), chat("private")] },
		{ _tag: "change", chat: chat("private") },
		{ _tag: "change", chat: chat("shared") },
	];
	const source = Stream.fromIterable(frames).pipe(
		filterChatCatalog,
		Stream.runCollect,
	);
	expect(await Effect.runPromise(source)).toEqual(frames);
	expect(
		await Effect.runPromise(
			source.pipe(Effect.provideService(CatalogVisibility, scope("shared"))),
		),
	).toEqual([
		{ _tag: "snapshot", chats: [chat("shared")] },
		{ _tag: "change", chat: chat("shared") },
	]);
});

it("preserves session cursors while suppressing private changes and removal IDs", async () => {
	const frames: SessionSummaryChange[] = [
		{
			_tag: "snapshot",
			cursor: 10,
			sessions: [session("visible"), session("secret", "private")],
		},
		{ _tag: "remove", sequence: 11, sessionId: SessionId.make("secret") },
		{ _tag: "change", sequence: 12, session: session("secret", "private") },
		{ _tag: "change", sequence: 13, session: session("new-visible") },
		{ _tag: "change", sequence: 14, session: session("visible", "private") },
		{ _tag: "remove", sequence: 15, sessionId: SessionId.make("visible") },
		{ _tag: "remove", sequence: 16, sessionId: SessionId.make("new-visible") },
	];
	const source = Stream.fromIterable(frames).pipe(
		filterSessionCatalog,
		Stream.runCollect,
	);
	expect(await Effect.runPromise(source)).toEqual(frames);
	expect(
		await Effect.runPromise(
			source.pipe(Effect.provideService(CatalogVisibility, scope("shared"))),
		),
	).toEqual([
		{ _tag: "snapshot", cursor: 10, sessions: [session("visible")] },
		{ _tag: "change", sequence: 13, session: session("new-visible") },
		{ _tag: "remove", sequence: 14, sessionId: SessionId.make("visible") },
		{ _tag: "remove", sequence: 16, sessionId: SessionId.make("new-visible") },
	]);
});

it("replaces session snapshots on scope changes without inventing durable cursors", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const updates = yield* SubscriptionRef.make(scope("shared"));
				const first = yield* Deferred.make<void>();
				const second = yield* Deferred.make<void>();
				const frames: SessionSummaryChange[] = [];
				const source: Stream.Stream<SessionSummaryChange> = Stream.concat(
					Stream.succeed({
						_tag: "snapshot",
						cursor: 10,
						sessions: [session("visible"), session("secret", "private")],
					}),
					Stream.never,
				);
				const fiber = yield* source.pipe(
					filterSessionCatalog,
					withCatalogChanges,
					Stream.provideService(
						CatalogVisibilityChanges,
						SubscriptionRef.changes(updates),
					),
					Stream.take(3),
					Stream.runForEach((frame) =>
						Effect.gen(function* () {
							frames.push(frame);
							if (frames.length === 1)
								yield* Deferred.succeed(first, undefined);
							if (frames.length === 2)
								yield* Deferred.succeed(second, undefined);
						}),
					),
					Effect.forkChild,
				);
				yield* Deferred.await(first);
				yield* SubscriptionRef.set(updates, {
					chats: new Set<ChatId>(),
					projects: new Set<FolderId>(),
				});
				yield* Deferred.await(second);
				yield* SubscriptionRef.set(updates, scope("private"));
				yield* Fiber.join(fiber);
				expect(frames).toEqual([
					{ _tag: "snapshot", cursor: 10, sessions: [session("visible")] },
					{ _tag: "snapshot", cursor: 10, sessions: [] },
					{
						_tag: "snapshot",
						cursor: 10,
						sessions: [session("secret", "private")],
					},
				]);
			}),
		),
	);
});
