import { ChatId, CloudChatSummary, SessionId } from "@zuse/contracts";
import { Effect } from "effect";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	resume: vi.fn(),
	connect: vi.fn(),
}));
vi.mock("../../src/lib/rpc-client.ts", async (original) => ({
	...(await original<typeof import("../../src/lib/rpc-client.ts")>()),
	getControlPlaneRpcClient: async () => ({
		"cloud.workspaces.get": mocks.get,
		"cloud.workspaces.resume": mocks.resume,
		"cloud.workspaces.connect": mocks.connect,
	}),
}));

import { useCloudChatCatalogStore } from "../../src/lib/cloud-workspace-catalog.ts";
import { ensureCloudWorkspaceAttached } from "../../src/lib/cloud-workspaces.ts";
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
