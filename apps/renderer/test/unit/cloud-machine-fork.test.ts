import {
	type CloudChatSummary,
	EnvironmentId,
	FolderId,
	Message,
	MessageId,
	SessionId,
	SessionTimelineProjection,
} from "@zuse/contracts";
import { emptyTimelineProjection } from "@zuse/domain/projectors/timeline-reducer";
import { Effect } from "effect";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	snapshot: vi.fn(),
	overlay: vi.fn(),
	save: vi.fn(),
	load: vi.fn(),
	open: vi.fn(),
	create: vi.fn(),
}));
vi.mock("../../src/lib/session-timeline-client-bus.ts", () => ({
	getRendererClientBus: () => ({
		snapshot: mocks.snapshot,
		overlay: mocks.overlay,
	}),
	sessionTimelineResourceKey: (ref: unknown) => ref,
}));
vi.mock("../../src/lib/session-timeline-cache.ts", () => ({
	sessionTimelineCache: { save: mocks.save, load: mocks.load },
}));
vi.mock("../../src/lib/cloud-workspaces.ts", () => ({
	openCloudChat: mocks.open,
	summaryFromLaunch: ({ workspace }: { workspace: unknown }) => workspace,
}));
vi.mock("../../src/lib/rpc-client.ts", () => ({
	getControlPlaneRpcClient: async () => ({
		"cloud.workspaces.fork": mocks.create,
	}),
}));

import { forkCloudMachine } from "../../src/lib/cloud-machine-fork.ts";

beforeEach(() => vi.resetAllMocks());
test("stages and persists the child's local history before selecting the new machine", async () => {
	const source = SessionTimelineProjection.make({
		...emptyTimelineProjection(),
		messages: [
			Message.make({
				id: MessageId.make("point"),
				sessionId: SessionId.make("source"),
				role: "assistant",
				content: { _tag: "assistant", text: "Keep visible" },
				createdAt: new Date(0),
			}),
		],
	});
	mocks.snapshot.mockReturnValue({ data: source });
	mocks.save.mockResolvedValue(undefined);
	mocks.create.mockReturnValue(
		Effect.succeed({
			workspace: { workspaceId: "child-vm" },
			chatId: "child-chat",
			initialSessionId: SessionId.make("child"),
		}),
	);
	mocks.open.mockImplementation(async () => {
		expect(mocks.overlay).toHaveBeenCalled();
		expect(mocks.save).toHaveBeenCalledWith(
			expect.objectContaining({
				ref: {
					environmentId: EnvironmentId.make("child-vm"),
					sessionId: "child",
				},
				projection: expect.objectContaining({
					messages: [
						expect.objectContaining({
							id: "fork:child:point",
							sessionId: "child",
						}),
					],
				}),
				cursor: { epoch: "fork-preview:child-vm", version: 0 },
			}),
		);
	});
	await forkCloudMachine({
		cloud: {
			providerId: "boxd",
			workspaceId: "parent-vm",
			projectId: "project",
			branch: "main",
			agent: "codex",
			model: "model",
			runtimeMode: "full-access",
		} as CloudChatSummary,
		projectId: FolderId.make("local-project"),
		source: null,
		sourceSessionId: SessionId.make("source"),
		fromMessageId: MessageId.make("point"),
	});
	expect(mocks.open).toHaveBeenCalledOnce();
});
