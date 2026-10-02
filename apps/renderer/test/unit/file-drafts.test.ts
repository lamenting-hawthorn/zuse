import { FolderId, WorktreeId } from "@zuse/contracts";
import { describe, expect, it } from "vitest";

import { createFileDrafts, fileDraftKey } from "../../src/store/file-drafts.ts";

const owner = {
	account: "alice",
	workspace: "personal",
	localEnvironmentId: "laptop",
};
const file = {
	kind: "external",
	absPath: "/repo/main.ts",
	name: "main.ts",
	view: "edit",
} as const;
const draft = { content: "edited", baseline: "original", mtime: "1" };

describe("file drafts", () => {
	it("keeps remote checkouts and worktrees separate while resolving the local default", () => {
		const projectFile = {
			kind: "text",
			folderId: FolderId.make("repo"),
			worktreeId: null,
			path: "main.ts",
			name: "main.ts",
			view: "edit",
		} as const;
		const local = fileDraftKey(projectFile, owner);
		expect(
			fileDraftKey(
				{ ...projectFile, environmentId: owner.localEnvironmentId },
				owner,
			),
		).toBe(local);
		const keys = [
			local,
			fileDraftKey({ ...projectFile, environmentId: "server" }, owner),
			fileDraftKey({ ...projectFile, folderId: FolderId.make("other") }, owner),
			fileDraftKey(
				{ ...projectFile, worktreeId: WorktreeId.make("branch") },
				owner,
			),
			fileDraftKey({ ...projectFile, path: "other.ts" }, owner),
		];
		expect(new Set(keys).size).toBe(keys.length);
	});
	it("isolates the same path across accounts, workspaces, and environments", () => {
		const drafts = createFileDrafts();
		const owners = [
			owner,
			{ ...owner, account: "bob" },
			{ ...owner, workspace: "org:a" },
			{ ...owner, workspace: "org:b" },
			{ ...owner, localEnvironmentId: "other-laptop" },
		];
		const keys = owners.map((scope) => fileDraftKey(file, scope));
		expect(new Set(keys).size).toBe(owners.length);
		for (const [index, key] of keys.entries())
			drafts.retain(key, { ...draft, content: `draft ${index}` });
		for (const [index, scope] of owners.entries())
			expect(drafts.read(fileDraftKey(file, scope))?.content).toBe(
				`draft ${index}`,
			);
	});

	it("does not treat presentation changes as another file", () => {
		expect(fileDraftKey({ ...file, name: "renamed label" }, owner)).toBe(
			fileDraftKey(file, owner),
		);
	});

	it("retains only unsaved buffers and explicitly discards reloads", () => {
		const drafts = createFileDrafts();
		drafts.retain("file", draft);
		expect(drafts.read("file")).toEqual(draft);
		drafts.retain("file", { ...draft, content: draft.baseline });
		expect(drafts.read("file")).toBeUndefined();
		drafts.retain("file", draft);
		drafts.discard("file");
		expect(drafts.read("file")).toBeUndefined();
	});

	it("clears a saved buffer without touching another file", () => {
		const drafts = createFileDrafts();
		drafts.retain("a", draft);
		drafts.retain("b", draft);
		drafts.acknowledgeSave("a", draft.content, "2");
		expect(drafts.read("a")).toBeUndefined();
		expect(drafts.read("b")).toEqual(draft);
	});

	it("keeps edits made while a save was in flight with the new disk baseline", () => {
		const drafts = createFileDrafts();
		drafts.retain("file", { ...draft, content: "newer edits" });
		drafts.acknowledgeSave("file", "edited", "2");
		expect(drafts.read("file")).toEqual({
			content: "newer edits",
			baseline: "edited",
			mtime: "2",
		});
	});

	it("does not resurrect a discarded buffer on a late save acknowledgement", () => {
		const drafts = createFileDrafts();
		drafts.retain("file", draft);
		drafts.discard("file");
		drafts.acknowledgeSave("file", draft.content, "2");
		expect(drafts.read("file")).toBeUndefined();
	});
});
