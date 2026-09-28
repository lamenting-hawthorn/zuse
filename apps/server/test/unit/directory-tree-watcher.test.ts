import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { watch } = vi.hoisted(() => ({ watch: vi.fn() }));
vi.mock("node:fs", () => ({ watch }));

import { watchDirectoryTree } from "../../src/fs/directory-tree-watcher.ts";

afterEach(() => vi.restoreAllMocks());

describe("directory watcher errors", () => {
	it.each([
		"",
		"child",
	])("reports errors from %s to the recovery callback", async (relative) => {
		vi.spyOn(process, "platform", "get").mockReturnValue("linux");
		const root = await mkdtemp(path.join(tmpdir(), "zuse-watcher-error-"));
		const watchers = new Map<
			string,
			EventEmitter & { close: ReturnType<typeof vi.fn> }
		>();
		watch.mockImplementation((directory: string) => {
			const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
			watchers.set(directory, watcher);
			return watcher;
		});
		await mkdir(path.join(root, "child", "nested"), { recursive: true });
		const onError = vi.fn();
		const handle = await watchDirectoryTree({
			root,
			isExcludedDirectory: () => false,
			refreshExclusions: async () => {},
			onChange: vi.fn(),
			onError,
		});
		try {
			const error = new Error("watcher failed");
			watchers.get(path.join(root, relative))?.emit("error", error);
			expect(onError).toHaveBeenCalledExactlyOnceWith(error);
			if (relative !== "") {
				expect(
					watchers.get(path.join(root, "child"))?.close,
				).toHaveBeenCalledOnce();
				expect(
					watchers.get(path.join(root, "child", "nested"))?.close,
				).toHaveBeenCalledOnce();
				expect(watchers.get(root)?.close).not.toHaveBeenCalled();
			}
		} finally {
			handle.close();
			await rm(root, { recursive: true, force: true });
		}
	});
});
