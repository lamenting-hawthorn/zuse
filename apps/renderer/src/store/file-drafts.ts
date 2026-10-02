import type { OpenFile } from "./ui.ts";

export type FileDraft = Readonly<{
	content: string;
	baseline: string;
	mtime: string;
}>;

export const fileDraftKey = (
	file: Exclude<OpenFile, { kind: "image" }>,
	owner: {
		readonly account: string | null | undefined;
		readonly workspace: string;
		readonly localEnvironmentId: string;
	},
): string =>
	JSON.stringify([
		owner.account ?? null,
		owner.workspace,
		file.kind === "text"
			? (file.environmentId ?? owner.localEnvironmentId)
			: owner.localEnvironmentId,
		file.kind,
		...(file.kind === "text"
			? [file.folderId, file.worktreeId, file.path]
			: [file.absPath]),
	]);

/** Dirty buffers only; no filesystem writes, alternate file catalog, or persistence. */
export const createFileDrafts = () => {
	const drafts = new Map<string, FileDraft>();
	return {
		read: (key: string) => drafts.get(key),
		retain: (key: string, draft: FileDraft) => {
			if (draft.content === draft.baseline) drafts.delete(key);
			else drafts.set(key, { ...draft });
		},
		discard: (key: string) => {
			drafts.delete(key);
		},
		acknowledgeSave: (key: string, content: string, mtime: string) => {
			const current = drafts.get(key);
			if (current === undefined || current.content === content)
				drafts.delete(key);
			else drafts.set(key, { ...current, baseline: content, mtime });
		},
	};
};

export const fileDrafts = createFileDrafts();
