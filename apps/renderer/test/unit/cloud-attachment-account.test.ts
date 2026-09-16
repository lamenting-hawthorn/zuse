import { ChatId, CloudChatSummary, FolderId, SessionId } from "@zuse/contracts";
import { Effect } from "effect";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	resume: vi.fn(),
	connect: vi.fn(),
	checkpoint: vi.fn(),
	page: vi.fn(),
	activation: vi.fn(),
	releaseCheckpoint: vi.fn(),
	releasePage: vi.fn(),
	releaseActivation: vi.fn(),
	transcript: vi.fn(),
}));
vi.mock("../../src/lib/rpc-client.ts", async (original) => ({
	...(await original<typeof import("../../src/lib/rpc-client.ts")>()),
	getControlPlaneRpcClient: async () => ({
		"cloud.workspaces.get": mocks.get,
		"cloud.workspaces.resume": mocks.resume,
		"cloud.workspaces.connect": mocks.connect,
		"cloud.transcript.get": mocks.transcript,
	}),
}));
vi.mock("../../src/lib/session-timeline-client-bus.ts", async (original) => ({
	...(await original<
		typeof import("../../src/lib/session-timeline-client-bus.ts")
	>()),
	registerSessionTimelineCheckpointSynchronizer: mocks.checkpoint,
	registerSessionTimelineOlderPageSynchronizer: mocks.page,
	registerEnvironmentActivation: mocks.activation,
}));

import { useCloudChatCatalogStore } from "../../src/lib/cloud-workspace-catalog.ts";
import {
	ensureCloudWorkspaceAttached,
	openCloudChat,
	stageCloudChat,
} from "../../src/lib/cloud-workspaces.ts";
import { observeRendererAccount } from "../../src/lib/renderer-account.ts";

const summary = CloudChatSummary.make({
	workspaceId: "attachment-account",
	projectId: "project",
	repositoryIdentity: "github.com/example/repo",
	repositoryDisplayName: "repo",
	chatId: ChatId.make("chat"),
	initialSessionId: SessionId.make("session"),
	activeSessionId: null,
	title: "Cloud chat",
	branch: "cloud",
	providerId: "codex",
	agent: "codex",
	model: "test",
	state: "ready",
	desiredState: "ready",
	runtimeState: "online",
	statusCode: "agent-running",
	startupPhase: "running",
	revision: 1,
	summaryRevision: 1,
	sessionHeadVersion: 0,
	unread: false,
	lastMessageAt: 1,
	createdAt: 1,
	updatedAt: 1,
});

beforeEach(() => {
	observeRendererAccount(null);
	mocks.get.mockReset();
	mocks.resume.mockReset();
	mocks.connect.mockReset();
	mocks.checkpoint.mockReset().mockReturnValue(mocks.releaseCheckpoint);
	mocks.page.mockReset().mockReturnValue(mocks.releasePage);
	mocks.activation.mockReset().mockReturnValue(mocks.releaseActivation);
	mocks.releaseCheckpoint.mockClear();
	mocks.releasePage.mockClear();
	mocks.releaseActivation.mockClear();
	mocks.transcript.mockReset();
});

it("releases account-owned resolver callbacks and registers fresh ones after switching", () => {
	observeRendererAccount("first");
	stageCloudChat(summary, FolderId.make("project"));
	expect(mocks.activation).toHaveBeenCalledOnce();
	observeRendererAccount("first");
	expect(mocks.releaseActivation).not.toHaveBeenCalled();
	observeRendererAccount("second");
	expect(mocks.releaseCheckpoint).toHaveBeenCalledOnce();
	expect(mocks.releasePage).toHaveBeenCalledOnce();
	expect(mocks.releaseActivation).toHaveBeenCalledOnce();
	stageCloudChat(summary, FolderId.make("project"));
	expect(mocks.activation).toHaveBeenCalledTimes(2);
});

it("discards delayed transcript results and rejects old activation callbacks", async () => {
	observeRendererAccount("first");
	stageCloudChat(summary, FolderId.make("project"));
	const checkpoint = mocks.checkpoint.mock.calls[0]?.[1];
	const activate = mocks.activation.mock.calls[0]?.[1];
	let resolve!: (value: unknown) => void;
	const result = new Promise<unknown>((done) => {
		resolve = done;
	});
	mocks.transcript.mockImplementation(() => Effect.promise(() => result));
	const pending = checkpoint(
		{ sessionId: summary.initialSessionId },
		{ origin: "cache", cursor: null },
	);
	await vi.waitFor(() => expect(mocks.transcript).toHaveBeenCalledOnce());
	observeRendererAccount("second");
	observeRendererAccount("first");
	resolve({ checkpoint: { stale: true } });
	expect(await pending).toBeNull();
	await expect(activate("wake")).rejects.toThrow("connection account changed");
	expect(mocks.get).not.toHaveBeenCalled();
});

it("does not select a queued cloud chat after the initiating account signs out", async () => {
	observeRendererAccount("first");
	const pending = openCloudChat(summary, FolderId.make("project"));
	const rejected = expect(pending).rejects.toThrow(
		"connection account changed",
	);
	observeRendererAccount(null);
	await rejected;
	expect(useCloudChatCatalogStore.getState().summaries).toEqual([]);
	expect(mocks.activation).not.toHaveBeenCalled();
});

it("does not reuse an earlier account attachment or publish its delayed result", async () => {
	let resolve!: (value: unknown) => void;
	const pending = new Promise<unknown>((done) => {
		resolve = done;
	});
	mocks.get.mockImplementationOnce(() => Effect.promise(() => pending));
	observeRendererAccount("first");
	const first = ensureCloudWorkspaceAttached(summary, "connect");
	const rejected = expect(first).rejects.toThrow("connection account changed");
	await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledOnce());
	observeRendererAccount("second");
	observeRendererAccount("first");
	mocks.get.mockImplementationOnce(() =>
		Effect.fail(new Error("new account lookup")),
	);
	await expect(
		ensureCloudWorkspaceAttached(summary, "connect"),
	).rejects.toThrow("new account lookup");
	resolve({ state: "paused" });
	await rejected;
	expect(mocks.get).toHaveBeenCalledTimes(2);
	expect(mocks.resume).not.toHaveBeenCalled();
	expect(mocks.connect).not.toHaveBeenCalled();
	expect(useCloudChatCatalogStore.getState().summaries).toEqual([]);
});

it("does not escalate an old passive attachment into a wake after sign-out", async () => {
	let resolve!: (value: unknown) => void;
	const pending = new Promise<unknown>((done) => {
		resolve = done;
	});
	mocks.get.mockImplementation(() => Effect.promise(() => pending));
	observeRendererAccount("first");
	const passive = ensureCloudWorkspaceAttached(summary, "connect");
	const passiveRejected = expect(passive).rejects.toThrow(
		"connection account changed",
	);
	await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledOnce());
	const wake = ensureCloudWorkspaceAttached(summary, "wake");
	const wakeRejected = expect(wake).rejects.toThrow(
		"connection account changed",
	);
	observeRendererAccount(null);
	resolve({ state: "paused" });
	await passiveRejected;
	await wakeRejected;
	expect(mocks.get).toHaveBeenCalledOnce();
	expect(mocks.resume).not.toHaveBeenCalled();
});
