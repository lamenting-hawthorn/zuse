import {
	cloudChatPlaceholder,
	cloudSessionPlaceholder,
} from "@zuse/client-runtime/cloud-catalog";
import {
	openCloudTranscriptCheckpoint,
	openCloudTranscriptPage,
} from "@zuse/client-runtime/cloud-transcript";
import type { SessionRef } from "@zuse/client-runtime/resource-ref";
import type {
	ConnectionView,
	ResourceView,
} from "@zuse/client-runtime/resource-state";
import type { SessionTimelineProjection } from "@zuse/contracts";
import {
	type ChatId,
	type CloudChatSummary,
	type CloudWorkspace,
	EnvironmentId,
	FolderId,
	type GitOriginInfo,
	Message,
	MessageId,
	type SessionId,
} from "@zuse/contracts";
import { Duration, Effect, Fiber, Schedule, Stream } from "effect";
import {
	cloudWorkspaceStartupError,
	isCloudWorkspaceReady,
	waitForCloudWorkspaceReady,
} from "../lib/cloud-workspace-lifecycle.ts";
import { overlayActiveEnvironmentShell } from "../lib/environment-entities.ts";
import { formatError } from "../lib/format-error.ts";
import {
	getControlPlaneRpcClient,
	refreshCloudWorkspaceConnectionWithRecovery,
	registerCloudWorkspace,
} from "../lib/rpc-client.ts";
import {
	rememberCloudTimelineHead,
	sessionTimelineCache,
	timelineReadingPositionStore,
} from "../lib/session-timeline-cache.ts";
import {
	addOptimisticSessionMessage,
	getRendererClientBus,
	registerEnvironmentActivation,
	registerSessionTimelineCheckpointSynchronizer,
	registerSessionTimelineOlderPageSynchronizer,
	retryRendererEnvironmentConnection,
	stopCloudHistory,
} from "../lib/session-timeline-client-bus.ts";
import { createAtomStore as create } from "../state/atom-store.ts";
import { useArchivePreviewStore } from "../store/archive-preview.ts";
import { useChatsStore } from "../store/chats.ts";
import { useSessionsStore } from "../store/sessions.ts";
import { useUiStore } from "../store/ui.ts";
import { useWorkspaceStore } from "../store/workspace.ts";
import {
	beginCloudFetch,
	markCloudCatalogArrival,
	markCloudFetch,
} from "./cloud-fetch-timing.ts";
import {
	cloudSummaryActiveSessionId,
	cloudSummaryForChat,
	cloudSummaryForEnvironment,
	compareCloudChatSummaryVersion,
	findCloudSummaryForSelection,
	hydrateCloudChatCatalogPersistence,
	localProjectForCloudChat,
	localProjectForCloudEnvironment,
	optimisticallyArchiveCloudChat,
	reconcileCloudChatCatalog,
	registerCloudChat,
	registerCloudChatCatalogRefresh,
	useCloudChatCatalogStore,
} from "./cloud-workspace-catalog.ts";
import { isHostedProduct } from "./hosted-connect.ts";
import { hostedProjectFolderId } from "./hosted-workspace.ts";
import {
	assertRendererAccountCurrent,
	type RendererAccountSnapshot,
	rendererAccountSnapshot,
	subscribeRendererAccount,
} from "./renderer-account.ts";

type CloudChatsState = {
	readonly loading: boolean;
	readonly error: string | null;
	readonly hydrate: () => Promise<void>;
	readonly archive: (summary: CloudChatSummary) => Promise<void>;
};

const opening = new Map<string, Promise<void>>();
type CloudAttachment = {
	account: RendererAccountSnapshot;
	activation: "connect" | "wake";
	promise: Promise<void>;
};
const attaching = new Map<string, CloudAttachment>();
const registeredCloudEnvironments = new Map<string, CloudChatSummary>();
const rearmedClientByWorkspace = new Map<string, string>();
let hydration: Promise<void> | null = null;
let catalogGeneration = 0;
let hydrationRequested = false;

/**
 * An authoritative ready runtime is a new recovery signal for a client whose
 * socket exhausted its retry ladder while compute was asleep. Include both
 * lifecycle revision and client generation so each real state change gets one
 * automatic attempt without turning a persistent outage into a retry storm.
 */
export const cloudConnectionRearmKey = (
	summary: CloudChatSummary,
	connection: ConnectionView,
): string | null =>
	summary.state === "ready" &&
	summary.runtimeState === "online" &&
	connection.phase === "failed"
		? `${summary.workspaceId}:${summary.revision}:${connection.generation}`
		: null;

export const rearmReadyCloudConnection = (
	summary: CloudChatSummary,
	connection: ConnectionView,
	attempts: Map<string, string>,
	retry: (environmentId: EnvironmentId) => void,
): boolean => {
	const key = cloudConnectionRearmKey(summary, connection);
	if (key === null || attempts.get(summary.workspaceId) === key) return false;
	attempts.set(summary.workspaceId, key);
	retry(EnvironmentId.make(summary.workspaceId));
	return true;
};

export const rearmRegisteredCloudConnection = (
	summary: CloudChatSummary,
): void => {
	const environmentId = EnvironmentId.make(summary.workspaceId);
	rearmReadyCloudConnection(
		summary,
		getRendererClientBus().connection(environmentId),
		rearmedClientByWorkspace,
		(retryEnvironmentId) =>
			queueMicrotask(() =>
				retryRendererEnvironmentConnection(retryEnvironmentId),
			),
	);
};

const trackCloudAttachment = (
	workspaceId: string,
	activation: CloudAttachment["activation"],
	operation: Promise<void>,
	account: RendererAccountSnapshot,
): Promise<void> => {
	let tracked: Promise<void>;
	tracked = operation.finally(() => {
		if (attaching.get(workspaceId)?.promise === tracked) {
			attaching.delete(workspaceId);
		}
	});
	attaching.set(workspaceId, { activation, promise: tracked, account });
	return tracked;
};

/**
 * Cloud wakeup is an environment capability. Register it when catalog metadata
 * arrives so every ClientBus resource shares one attachment path instead of
 * teaching feature stores how to resume a workspace.
 */
const registerCloudEnvironmentResolver = (summary: CloudChatSummary): void => {
	const previous = registeredCloudEnvironments.get(summary.workspaceId);
	if (previous !== undefined) {
		if (compareCloudChatSummaryVersion(summary, previous) < 0) return;
		registeredCloudEnvironments.set(summary.workspaceId, summary);
		rearmRegisteredCloudConnection(summary);
		return;
	}
	registeredCloudEnvironments.set(summary.workspaceId, summary);
	let rootPrepared = false;
	registerSessionTimelineCheckpointSynchronizer(
		EnvironmentId.make(summary.workspaceId),
		async (ref, current: ResourceView<SessionTimelineProjection>) => {
			markCloudFetch(ref, "request-start");
			const control = await getControlPlaneRpcClient();
			markCloudFetch(ref, "control-ready");
			const result = await Effect.runPromise(
				control["cloud.transcript.get"]({
					workspaceId: summary.workspaceId,
					sessionId: ref.sessionId,
					// A local IndexedDB entry is only a rendering accelerator. API's
					// encrypted checkpoint is authoritative, so initial hydration requests
					// the full checkpoint even when the cache claims the same cursor.
					cursor:
						current.origin === "cache"
							? undefined
							: (current.cursor ?? undefined),
				}),
			);
			markCloudFetch(ref, "downloaded");
			const checkpoint = result.checkpoint;
			if (checkpoint === null) return null;
			const payload = await openCloudTranscriptCheckpoint(ref, checkpoint);
			markCloudFetch(ref, "decrypted");
			rememberCloudTimelineHead(ref, payload.projection, payload.cursor);

			return {
				data: payload.projection,
				cursor: payload.cursor,
				resetEpoch:
					current.cursor !== null &&
					current.cursor.epoch !== payload.cursor.epoch,
			};
		},
	);
	registerSessionTimelineOlderPageSynchronizer(
		EnvironmentId.make(summary.workspaceId),
		async (ref, cursor, beforeSequence) => {
			const control = await getControlPlaneRpcClient();
			const result = await Effect.runPromise(
				control["cloud.transcript.messages.page"]({
					workspaceId: summary.workspaceId,
					sessionId: ref.sessionId,
					cursor,
					beforeSequence,
				}),
			);
			const encrypted = result.page;
			if (encrypted === null) return null;
			return openCloudTranscriptPage(ref, cursor, beforeSequence, encrypted);
		},
	);
	registerEnvironmentActivation(
		EnvironmentId.make(summary.workspaceId),
		async (activation) => {
			const fallback =
				registeredCloudEnvironments.get(summary.workspaceId) ?? summary;
			const current =
				useCloudChatCatalogStore
					.getState()
					.summaries.find(
						(candidate) => candidate.workspaceId === summary.workspaceId,
					) ??
				cloudSummaryForChat(fallback.chatId) ??
				fallback;
			await ensureCloudWorkspaceEnvironment(current, activation);
		},
		async (client) => {
			if (rootPrepared) return;
			const folders = await Effect.runPromise(client["workspace.list"]({}));
			// The cloud runtime registers the selected checkout before API marks the
			// sandbox repository-ready. Never manufacture a second, placeholder root.
			rootPrepared = folders.length > 0;
		},
		"cloud-workspace",
	);
	rearmRegisteredCloudConnection(summary);
};

const refreshSummaryFromWorkspace = (
	summary: CloudChatSummary,
	workspace: CloudWorkspace,
): CloudChatSummary => ({
	...summary,
	codexAuthMode: workspace.codexAuthMode,
	providerAuthMode: workspace.providerAuthMode,
	state: workspace.state,
	runtimeState: workspace.runtimeState,
	statusCode: workspace.statusCode,
	failureDiagnostic: workspace.failureDiagnostic,
	startupPhase: workspace.startupPhase,
	desiredState: workspace.desiredState,
	revision: workspace.revision,
	updatedAt: workspace.updatedAt,
});

/** Resolve account-owned projects even before a runtime mapping exists. */
const projectForSummary = (summary: CloudChatSummary): FolderId | null =>
	isHostedProduct()
		? hostedProjectFolderId(summary.projectId)
		: localProjectForCloudEnvironment(summary.workspaceId);

const updateSummary = (summary: CloudChatSummary): void => {
	const current = cloudSummaryForEnvironment(summary.workspaceId);
	if (current !== null && compareCloudChatSummaryVersion(summary, current) < 0)
		return;
	registerCloudChat(summary);
	const accepted = cloudSummaryForEnvironment(summary.workspaceId) ?? summary;
	registerCloudEnvironmentResolver(accepted);
	const projectId = projectForSummary(summary);
	if (projectId !== null) stageCloudChat(accepted, projectId);
};

export const repositoryIdentityForOrigin = (
	origin: GitOriginInfo | null | undefined,
): string | null =>
	origin === null || origin === undefined
		? null
		: `${origin.host.toLowerCase()}/${origin.owner.toLowerCase()}/${origin.repo.toLowerCase()}`;

export { cloudSessionPlaceholder } from "@zuse/client-runtime/cloud-catalog";

/**
 * API catalog rows are placeholders only. The environment runtime timeline
 * replaces this shell as soon as the user retains the chat resource.
 */
export const stageCloudChat = (
	summary: CloudChatSummary,
	projectId: FolderId,
	legacyFirstMessage?: string,
): void => {
	const previous = cloudSummaryForEnvironment(summary.workspaceId);
	if (
		previous !== null &&
		compareCloudChatSummaryVersion(summary, previous) < 0
	)
		return;
	registerCloudChat(summary, projectId);
	const accepted = cloudSummaryForEnvironment(summary.workspaceId) ?? summary;
	registerCloudEnvironmentResolver(accepted);
	const activeSessionId = cloudSummaryActiveSessionId(accepted);
	const chat = cloudChatPlaceholder(
		{ ...accepted, activeSessionId },
		projectId,
	);
	const archives = useArchivePreviewStore.getState();
	if (chat.archivedAt !== null) {
		archives.upsertChat(chat);
	} else if (
		archives.chatsByProject[projectId]?.some((row) => row.id === chat.id)
	) {
		archives.removeChat(chat.id, projectId);
	}
	const session =
		activeSessionId === null
			? null
			: cloudSessionPlaceholder(accepted, projectId, activeSessionId);
	overlayActiveEnvironmentShell((shell) => ({
		...shell,
		chatsByProject: {
			...shell.chatsByProject,
			[projectId]: [
				chat,
				...(shell.chatsByProject[projectId] ?? []).filter(
					(candidate) => candidate.id !== chat.id,
				),
			],
		},
		sessionsByProject: {
			...shell.sessionsByProject,
			[projectId]:
				session === null
					? (shell.sessionsByProject[projectId] ?? [])
					: [
							session,
							...(shell.sessionsByProject[projectId] ?? []).filter(
								(candidate) => candidate.id !== session.id,
							),
						],
		},
	}));
	// Compatibility only: an API that did not acknowledge mailbox-v1 still owns
	// the prompt in its encrypted launch intent. The stable ID is replaced by the
	// authoritative launch message rather than producing a duplicate.
	if (legacyFirstMessage !== undefined) {
		addOptimisticSessionMessage(
			{
				environmentId: EnvironmentId.make(accepted.workspaceId),
				sessionId: accepted.initialSessionId,
			} satisfies SessionRef,
			Message.make({
				id: MessageId.make(`launch:${accepted.workspaceId}:message`),
				sessionId: accepted.initialSessionId,
				role: "user",
				content: { _tag: "user", text: legacyFirstMessage, goal: false },
				createdAt: new Date(accepted.createdAt),
			}),
		);
	}
	useChatsStore.setState({ error: null });
};

export const openCloudChat = (
	summary: CloudChatSummary,
	projectId: FolderId,
): Promise<void> => {
	const existing = opening.get(summary.workspaceId);
	if (existing !== undefined) return existing;
	const operation = Promise.resolve().then(() => {
		stageCloudChat(summary, projectId);
		const activeSessionId = cloudSummaryActiveSessionId(summary);
		if (activeSessionId !== null)
			beginCloudFetch({
				environmentId: EnvironmentId.make(summary.workspaceId),
				sessionId: activeSessionId,
			});
		// Catalog selection must not depend on a paused runtime shell. Select the
		// durable ids now so the qualified timeline cache can hydrate immediately.
		useUiStore.getState().setActiveMainTab("chat");
		useChatsStore.setState((state) => ({
			selectedChatId: summary.chatId,
			selectedChatByProject: {
				...state.selectedChatByProject,
				[projectId]: summary.chatId,
			},
		}));
		useSessionsStore.setState((state) => ({
			selectedSessionId: activeSessionId,
			selectedSessionByProject: {
				...state.selectedSessionByProject,
				[projectId]: activeSessionId,
			},
		}));
		if (useWorkspaceStore.getState().selectedFolderId !== projectId) {
			void useWorkspaceStore.getState().select(projectId);
		}
		// The retained timeline hydrates cache first. EnvironmentRuntime then
		// prepares the gateway and attaches in one ordered background operation.
	});
	const tracked = operation.finally(() => opening.delete(summary.workspaceId));
	opening.set(summary.workspaceId, tracked);
	return tracked;
};

const workspaceNeedsWake = (
	workspace: Pick<CloudWorkspace, "state">,
): boolean => workspace.state === "paused" || workspace.state === "failed";

/** Cloud is an EnvironmentResolver capability, not a second message path. */
export const ensureCloudWorkspaceAttached = (
	summary: CloudChatSummary,
	activation: "connect" | "wake" = "wake",
): Promise<void> => {
	const account = rendererAccountSnapshot();
	const existing = attaching.get(summary.workspaceId);
	if (existing !== undefined && existing.account === account) {
		if (existing.activation === "wake" || activation === "connect") {
			return existing.promise;
		}
		// A live command can arrive while a passive transcript attachment is still
		// resolving. Wake is a stronger side effect: never let it inherit the
		// passive request's failure (for example when API has just paused compute).
		const escalated = existing.promise
			.catch(() => undefined)
			.then(() => attachCloudWorkspace(summary, "wake", account));
		return trackCloudAttachment(
			summary.workspaceId,
			"wake",
			escalated,
			account,
		);
	}
	return trackCloudAttachment(
		summary.workspaceId,
		activation,
		attachCloudWorkspace(summary, activation, account),
		account,
	);
};

const attachCloudWorkspace = async (
	summary: CloudChatSummary,
	activation: "connect" | "wake",
	account: RendererAccountSnapshot,
): Promise<void> => {
	assertRendererAccountCurrent(account);
	const publish = (workspace: CloudWorkspace): void => {
		assertRendererAccountCurrent(account);
		updateSummary(refreshSummaryFromWorkspace(summary, workspace));
	};
	const control = await getControlPlaneRpcClient();
	assertRendererAccountCurrent(account);
	let workspace = await Effect.runPromise(
		control["cloud.workspaces.get"]({ workspaceId: summary.workspaceId }),
	);
	assertRendererAccountCurrent(account);
	if (workspaceNeedsWake(workspace) && activation === "wake") {
		workspace = await Effect.runPromise(
			control["cloud.workspaces.resume"]({
				workspaceId: summary.workspaceId,
			}),
		);
	}
	publish(workspace);
	if (activation === "connect" && !isCloudWorkspaceReady(workspace)) {
		throw new Error(
			workspace.state === "paused"
				? "Cloud workspace is paused."
				: "Cloud workspace is not currently available for passive attachment.",
		);
	}
	if (!isCloudWorkspaceReady(workspace)) {
		const error = cloudWorkspaceStartupError(workspace);
		if (error !== null) throw error;
		workspace = await waitForCloudWorkspaceReady(
			control["cloud.workspaces.watch"]({
				workspaceId: summary.workspaceId,
				afterRevision: workspace.revision,
			}),
			publish,
		);
	}
	const connectionForWorkspace = () =>
		refreshCloudWorkspaceConnectionWithRecovery(
			summary.workspaceId,
			async (recoveryCommandId) => {
				assertRendererAccountCurrent(account);
				let recovered = await Effect.runPromise(
					control["cloud.workspaces.resume"]({
						workspaceId: summary.workspaceId,
						recoverRuntime: true,
						commandId: recoveryCommandId,
					}),
				);
				publish(recovered);
				if (!isCloudWorkspaceReady(recovered)) {
					const error = cloudWorkspaceStartupError(recovered);
					if (error !== null) throw error;
					recovered = await waitForCloudWorkspaceReady(
						control["cloud.workspaces.watch"]({
							workspaceId: summary.workspaceId,
							afterRevision: recovered.revision,
						}),
						publish,
					);
				}
			},
			() => {
				assertRendererAccountCurrent(account);
				return Effect.runPromise(
					control["cloud.workspaces.connect"]({
						workspaceId: summary.workspaceId,
					}),
				);
			},
		);
	registerCloudWorkspace(
		summary.workspaceId,
		await connectionForWorkspace(),
		connectionForWorkspace,
		account,
	);
};

const ensureCloudWorkspaceEnvironment = (
	summary: CloudChatSummary,
	activation: "connect" | "wake",
): Promise<void> => ensureCloudWorkspaceAttached(summary, activation);

export { summaryFromLaunch } from "@zuse/client-runtime/cloud-catalog";
export { cloudSummaryForChat, localProjectForCloudChat };

const removeDeletedCloudPlaceholders = (
	removed: ReadonlyArray<CloudChatSummary>,
): void => {
	if (removed.length === 0) return;
	const chatIds = new Set(removed.map((summary) => summary.chatId));
	const archives = useArchivePreviewStore.getState();
	for (const [projectId, chats] of Object.entries(archives.chatsByProject)) {
		for (const chat of chats) {
			if (chatIds.has(chat.id))
				archives.removeChat(chat.id, FolderId.make(projectId));
		}
	}
	for (const summary of removed) {
		const ref = {
			environmentId: EnvironmentId.make(summary.workspaceId),
			sessionId: summary.initialSessionId,
		};
		void Promise.all([
			sessionTimelineCache?.remove(ref),
			timelineReadingPositionStore?.remove(ref),
		]).catch(() => undefined);
	}
	const sessionIds = new Set(
		removed.map((summary) => summary.initialSessionId),
	);
	overlayActiveEnvironmentShell((shell) => ({
		...shell,
		chatsByProject: Object.fromEntries(
			Object.entries(shell.chatsByProject).map(([projectId, chats]) => [
				projectId,
				chats.filter((chat) => !chatIds.has(chat.id)),
			]),
		),
		sessionsByProject: Object.fromEntries(
			Object.entries(shell.sessionsByProject).map(([projectId, sessions]) => [
				projectId,
				sessions.filter((session) => !sessionIds.has(session.id)),
			]),
		),
	}));
	useChatsStore.setState((state) => ({
		selectedChatId:
			state.selectedChatId !== null && chatIds.has(state.selectedChatId)
				? null
				: state.selectedChatId,
		selectedChatByProject: Object.fromEntries(
			Object.entries(state.selectedChatByProject).map(([projectId, chatId]) => [
				projectId,
				chatId !== null && chatIds.has(chatId) ? null : chatId,
			]),
		),
	}));
	useSessionsStore.setState((state) => ({
		selectedSessionId:
			state.selectedSessionId !== null &&
			sessionIds.has(state.selectedSessionId)
				? null
				: state.selectedSessionId,
		selectedSessionByProject: Object.fromEntries(
			Object.entries(state.selectedSessionByProject).map(
				([projectId, sessionId]) => [
					projectId,
					sessionId !== null && sessionIds.has(sessionId) ? null : sessionId,
				],
			),
		),
	}));
};

export const useCloudChatsStore = create<CloudChatsState>((set) => ({
	loading: false,
	error: null,
	hydrate: async () => {
		hydrationRequested = true;
		const account = rendererAccountSnapshot();
		if (typeof account.subject !== "string") return;
		if (hydration !== null) return hydration;
		const generation = catalogGeneration;
		const pending = (async () => {
			set({ loading: true, error: null });
			try {
				await hydrateCloudChatCatalogPersistence();
				if (rendererAccountSnapshot() !== account) return;
				for (const cached of useCloudChatCatalogStore.getState().summaries) {
					registerCloudEnvironmentResolver(cached);
					const cachedProject = projectForSummary(cached);
					if (cachedProject !== null) stageCloudChat(cached, cachedProject);
				}
				const client = await getControlPlaneRpcClient();

				const result = await Effect.runPromise(
					client["cloud.chats.list"]({ scope: "all" }),
				);
				if (generation !== catalogGeneration || rendererAccountSnapshot() !== account) return;
				removeDeletedCloudPlaceholders(reconcileCloudChatCatalog(result.chats));
				for (const summary of result.chats) {
					const accepted =
						cloudSummaryForEnvironment(summary.workspaceId) ?? summary;
					registerCloudEnvironmentResolver(accepted);
					const projectId = projectForSummary(accepted);
					if (projectId !== null) stageCloudChat(accepted, projectId);
				}
				void (async () => {
					for (const [workspaceId, intent] of Object.entries(
						useCloudChatCatalogStore.getState().archiveIntents,
					)) {
						if (generation !== catalogGeneration) return;
						const cached = cloudSummaryForEnvironment(workspaceId);
						if (cached === null) continue;
						try {
							const archived = await Effect.runPromise(
								client["cloud.workspaces.archive"]({
									workspaceId,
									commandId: intent.commandId,
								}),
							);
							if (generation !== catalogGeneration) return;
							updateSummary({
								...refreshSummaryFromWorkspace(cached, archived),
								archivedAt: intent.requestedAt,
							});
						} catch {
							// The persisted intent remains hidden and retries on the next hydrate.
						}
					}
				})().catch(() => undefined);
				set({ loading: false });
			} catch (cause) {
				if (rendererAccountSnapshot() === account)
					set({ error: formatError(cause), loading: false });
			}
		})().finally(() => {
			if (hydration === pending) hydration = null;
		});
		hydration = pending;
		return pending;
	},
	archive: async (summary) => {
		const account = rendererAccountSnapshot();
		const archivedAt = Date.now();
		const commandId = crypto.randomUUID();
		const optimistic = optimisticallyArchiveCloudChat(
			summary,
			archivedAt,
			commandId,
		);
		const projectId = projectForSummary(summary);
		if (projectId !== null) stageCloudChat(optimistic, projectId);
		try {
			const client = await getControlPlaneRpcClient();
			if (rendererAccountSnapshot() !== account) return;
			const workspace = await Effect.runPromise(
				client["cloud.workspaces.archive"]({
					workspaceId: summary.workspaceId,
					commandId,
				}),
			);
			if (rendererAccountSnapshot() !== account) return;
			updateSummary({
				...refreshSummaryFromWorkspace(summary, workspace),
				archivedAt,
			});
		} catch (cause) {
			if (rendererAccountSnapshot() === account)
				set({ error: formatError(cause) });
			// A response can be lost after API durably accepts the command. Keep
			// the persisted intent as the authoritative optimistic fence and retry
			// it during catalog hydration instead of flashing the row back into the
			// active list. Reconciliation clears it only after API publishes the
			// archived lifecycle state.
		}
	},
}));

let catalogAccount = rendererAccountSnapshot();
const unsubscribeCatalogAccount = useCloudChatCatalogStore.subscribe(
	(_state, previous) => {
		const current = rendererAccountSnapshot();
		if (current === catalogAccount) return;
		catalogAccount = current;
		removeDeletedCloudPlaceholders(previous.summaries);
	},
);
const unsubscribeAccount = subscribeRendererAccount(() => {
	hydration = null;
	useCloudChatsStore.setState({ loading: false, error: null });
	if (
		hydrationRequested &&
		typeof rendererAccountSnapshot().subject === "string"
	)
		void useCloudChatsStore.getState().hydrate();
});
if (import.meta.hot)
	import.meta.hot.dispose(() => {
		unsubscribeCatalogAccount();
		unsubscribeAccount();
	});

registerCloudChatCatalogRefresh(() => useCloudChatsStore.getState().hydrate());

export const useCloudChatSummaryForSelection = ({
	chatId,
	sessionId,
}: {
	readonly chatId: ChatId | null;
	readonly sessionId: SessionId | null;
}): CloudChatSummary | null => {
	return useCloudChatCatalogStore((state) =>
		findCloudSummaryForSelection(state.summaries, { chatId, sessionId }),
	);
};

export const useCloudChatSummaryForSession = (
	sessionId: SessionId | null,
): CloudChatSummary | null =>
	useCloudChatSummaryForSelection({ chatId: null, sessionId });

/** One account catalog feed owned by the signed-in sidebar lifecycle. */
export const watchCloudChatCatalog = (): (() => void) => {
	let stopped = false;
	let cursor: number | undefined;
	let fiber: Fiber.Fiber<unknown, unknown> | null = null;
	const start = async () => {
		await useCloudChatsStore.getState().hydrate();
		if (stopped) return;
		const stream = Stream.unwrap(
			Effect.tryPromise({
				try: async () =>
					(await getControlPlaneRpcClient())["cloud.chats.watch"]({ cursor }),
				catch: (cause) => cause,
			}),
		).pipe(
			Stream.retry(
				Schedule.exponential("500 millis").pipe(
					Schedule.modifyDelay(({ duration }) =>
						Effect.succeed(
							Duration.millis(Math.min(Duration.toMillis(duration), 10_000)),
						),
					),
				),
			),
		);
		fiber = Effect.runFork(
			Stream.runForEach(stream, (page) =>
				Effect.sync(() => {
					if (
						stopped ||
						(cursor !== undefined && page.cursor < cursor && !page.reset)
					)
						return;
					if (
						!page.reset &&
						page.chats.length === 0 &&
						page.deletedWorkspaceIds.length === 0
					) {
						cursor = page.cursor;
						return;
					}
					const current = useCloudChatCatalogStore.getState().summaries;
					if (!page.reset)
						for (const chat of page.chats)
							if (
								!current.some(
									(existing) => existing.workspaceId === chat.workspaceId,
								)
							)
								markCloudCatalogArrival(new Date(chat.createdAt));
					const deleted = new Set(page.deletedWorkspaceIds);
					const updated = new Map(
						page.chats.map((chat) => [chat.workspaceId, chat]),
					);
					const next = page.reset
						? page.chats
						: [
								...current.filter(
									(chat) =>
										!deleted.has(chat.workspaceId) &&
										!updated.has(chat.workspaceId),
								),
								...page.chats,
							];
					removeDeletedCloudPlaceholders(reconcileCloudChatCatalog(next));
					for (const summary of page.chats) {
						const accepted =
							cloudSummaryForEnvironment(summary.workspaceId) ?? summary;
						registerCloudEnvironmentResolver(accepted);
						const projectId = projectForSummary(accepted);
						if (projectId !== null) stageCloudChat(accepted, projectId);
					}
					cursor = page.cursor;
				}),
			).pipe(
				Effect.catchCause((cause) =>
					Effect.sync(() => {
						if (!stopped)
							useCloudChatsStore.setState({ error: formatError(cause) });
					}),
				),
			),
		);
	};
	void start().catch((cause) => {
		if (!stopped) useCloudChatsStore.setState({ error: formatError(cause) });
	});
	return () => {
		stopped = true;
		catalogGeneration++;
		stopCloudHistory();
		if (fiber !== null) void Effect.runPromise(Fiber.interrupt(fiber));
	};
};
