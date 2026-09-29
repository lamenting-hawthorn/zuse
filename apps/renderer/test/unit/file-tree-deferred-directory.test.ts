import { EnvironmentId, FolderId, FsEntry } from "@zuse/contracts";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

const { client } = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("../../src/lib/session-timeline-client-bus.ts", () => ({
	getRendererClientBus: () => ({ client }),
	registerRendererResourceDriver: vi.fn(),
	registerRendererResourcePersistence: vi.fn(),
}));

import { listDeferredDirectory } from "../../src/lib/file-tree-client-bus.ts";

const ref = {
	environmentId: EnvironmentId.make("workspace-persian"),
	folderId: FolderId.make("repo"),
	worktreeId: null,
	rootPath: "/workspace/repo",
};

afterEach(() => vi.resetAllMocks());

describe("deferred file-tree directory loading", () => {
	it("uses the ClientBus connection for the requested environment", async () => {
		const entries = [
			FsEntry.make({
				name: "index.js",
				path: "node_modules/index.js",
				kind: "file",
			}),
		];
		const tree = vi.fn(() => Effect.succeed(entries));
		client.mockReturnValue({ "fs.tree": tree });
		expect(await listDeferredDirectory(ref, "node_modules")).toEqual(entries);
		expect(client).toHaveBeenCalledWith(ref.environmentId);
		expect(tree).toHaveBeenCalledWith({
			folderId: ref.folderId,
			worktreeId: null,
			path: "node_modules",
		});
	});

	it("rejects disconnected reads so the directory can be retried", async () => {
		client.mockReturnValue(null);
		await expect(listDeferredDirectory(ref, "node_modules")).rejects.toThrow(
			"File tree is not connected.",
		);
	});
});
