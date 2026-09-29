import {
	ChatId,
	CloudChatSummary,
	EnvironmentId,
	FolderId,
	SessionId,
} from "@zuse/contracts";
import { Effect } from "effect";
import { beforeEach, expect, it, vi } from "vitest";
import { useCloudChatCatalogStore } from "../../src/lib/cloud-workspace-catalog.ts";
import {
	stageCloudChat,
	useCloudChatsStore,
} from "../../src/lib/cloud-workspaces.ts";
import { observeRendererAccount } from "../../src/lib/renderer-account.ts";
import {
	setArchiveCommandForTest,
	useArchivePreviewStore,
} from "../../src/store/archive-preview.ts";

vi.mock("../../src/lib/rpc-client.ts", async (original) => ({
	...(await original<typeof import("../../src/lib/rpc-client.ts")>()),
	getControlPlaneRpcClient: async () => ({
		"cloud.chats.list": () => Effect.succeed({ chats: [] }),
	}),
}));

const projectId = FolderId.make("archive-projection-project");
const summary = CloudChatSummary.make({
	workspaceId: "archive-projection-workspace",
	projectId: "api-project",
	repositoryIdentity: "github.com/zuse/zuse",
	repositoryDisplayName: "zuse",
	chatId: ChatId.make("archived-cloud-chat"),
	initialSessionId: SessionId.make("cloud-session"),
	title: "Onboarding",
	branch: "ponyta",
	providerId: "boxd",
	agent: "codex",
	model: "gpt-6-astra",
	state: "archived",
	desiredState: "archived",
	runtimeState: "offline",
	statusCode: "archived",
	startupPhase: "running",
	revision: 2,
	summaryRevision: 1,
	sessionHeadVersion: 1,
	unread: false,
	lastMessageAt: 1,
	createdAt: 1,
	updatedAt: 2,
	archivedAt: 2,
});
beforeEach(() => {
	useCloudChatCatalogStore.setState(useCloudChatCatalogStore.getInitialState());
	useArchivePreviewStore.setState(useArchivePreviewStore.getInitialState());
	setArchiveCommandForTest(async () => [] as never);
});
it("hydrates cloud archives after restart and retains them after a local list refresh", async () => {
	stageCloudChat(summary, projectId);
	await useArchivePreviewStore
		.getState()
		.loadProject(EnvironmentId.make("local"), projectId);
	expect(
		useArchivePreviewStore
			.getState()
			.chatsByProject[projectId]?.map((chat) => chat.id),
	).toEqual([summary.chatId]);
});
it("removes a cloud archive when a newer catalog summary restores it", () => {
	stageCloudChat(summary, projectId);
	stageCloudChat(
		{
			...summary,
			archivedAt: undefined,
			state: "paused",
			desiredState: "paused",
			revision: 3,
		},
		projectId,
	);
	expect(
		useArchivePreviewStore.getState().chatsByProject[projectId] ?? [],
	).toEqual([]);
});
it("opens cloud archive metadata without querying the local runtime", async () => {
	stageCloudChat(summary, projectId);
	const chat = useArchivePreviewStore.getState().chatsByProject[projectId]?.[0];
	expect(chat).toBeDefined();
	if (!chat) return;
	setArchiveCommandForTest(async () => {
		throw new Error("Cloud chat is absent from local runtime");
	});
	await useArchivePreviewStore
		.getState()
		.openChat(EnvironmentId.make("local"), chat);
	expect(useArchivePreviewStore.getState().errorByChat[chat.id]).toBeNull();
	expect(useArchivePreviewStore.getState().selectedSessionByChat[chat.id]).toBe(
		summary.initialSessionId,
	);
});

it("retains the catalog archive when the local shell has a stale active copy", async () => {
	stageCloudChat(summary, projectId);
	const chat = useArchivePreviewStore.getState().chatsByProject[projectId]?.[0];
	if (chat === undefined) throw new Error("Cloud archive is missing");
	setArchiveCommandForTest(
		async () => [{ ...chat, archivedAt: null }] as never,
	);
	await useArchivePreviewStore
		.getState()
		.loadProject(EnvironmentId.make("local"), projectId);
	expect(useArchivePreviewStore.getState().chatsByProject[projectId]).toEqual([
		chat,
	]);
});
it("does not resurrect an archive from an older catalog revision", () => {
	stageCloudChat(summary, projectId);
	stageCloudChat(
		{
			...summary,
			archivedAt: undefined,
			state: "paused",
			desiredState: "paused",
			revision: 3,
		},
		projectId,
	);
	stageCloudChat(summary, projectId);
	expect(useArchivePreviewStore.getState().chatsByProject[projectId]).toEqual(
		[],
	);
});

it("removes deleted cloud archives and their open previews from every project on refresh", async () => {
	observeRendererAccount("archive-owner");
	const otherProjectId = FolderId.make("archive-projection-other");
	stageCloudChat(summary, projectId);
	stageCloudChat(summary, otherProjectId);
	for (const id of [projectId, otherProjectId]) {
		const chat = useArchivePreviewStore.getState().chatsByProject[id]?.[0];
		if (!chat) throw new Error("Cloud archive is missing");
		await useArchivePreviewStore
			.getState()
			.openChat(EnvironmentId.make("local"), chat);
	}
	await useCloudChatsStore.getState().hydrate();
	expect(useCloudChatsStore.getState().error).toBeNull();
	const archives = useArchivePreviewStore.getState();
	for (const id of [projectId, otherProjectId]) {
		expect(archives.chatsByProject[id]).toEqual([]);
		expect(archives.selectedChatByProject[id]).toBeNull();
	}
	expect(archives.previewsByChat[summary.chatId]).toBeUndefined();
	expect(archives.selectedSessionByChat[summary.chatId]).toBeUndefined();
});
