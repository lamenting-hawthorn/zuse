import { FileTree } from "@pierre/trees";
import { FsEntry } from "@zuse/contracts";
import { describe, expect, it, vi } from "vitest";
import {
	deferredDirectoryPaths,
	fileTreeSnapshotOperations,
	reconcileFileTreePaths,
} from "../../src/lib/file-tree-reconciliation.ts";

const file = (path: string) =>
	FsEntry.make({
		name: path.split("/").at(-1) ?? path,
		path,
		kind: "file",
	});

const directory = (path: string) =>
	FsEntry.make({
		name: path.split("/").at(-1) ?? path,
		path,
		kind: "directory",
	});

describe("file tree reconciliation", () => {
	it("refreshes only the changed file's parent", async () => {
		const listDirectory = vi.fn(async (path: string) =>
			path === "src" ? [file("src/app.ts"), file("src/new.ts")] : [],
		);
		const result = await reconcileFileTreePaths({
			changedPaths: ["src/new.ts"],
			knownPaths: new Set(["src/", "src/app.ts", "README.md"]),
			listDirectory,
		});

		expect(listDirectory).toHaveBeenCalledTimes(1);
		expect(listDirectory).toHaveBeenCalledWith("src");
		expect(result.operations).toEqual([{ type: "add", path: "src/new.ts" }]);
		expect([...result.paths]).toContain("README.md");
	});

	it("adds a new deferred directory without walking it", async () => {
		const listDirectory = vi.fn(async (path: string) =>
			path === ""
				? [
						FsEntry.make({
							name: "node_modules",
							path: "node_modules",
							kind: "directory",
							deferred: true,
						}),
						file("README.md"),
					]
				: [file(`${path}/unexpected.js`)],
		);
		const result = await reconcileFileTreePaths({
			changedPaths: ["node_modules"],
			knownPaths: new Set(["README.md"]),
			listDirectory,
		});

		expect(listDirectory).toHaveBeenCalledTimes(1);
		expect(result.operations).toEqual([{ type: "add", path: "node_modules/" }]);
		expect([...result.deferredDirectories]).toEqual(["node_modules"]);
	});

	it("does not list a known deferred directory when it changes", async () => {
		const listDirectory = vi.fn(async () => [
			FsEntry.make({
				name: "dist",
				path: "dist",
				kind: "directory",
				deferred: true,
			}),
		]);
		const result = await reconcileFileTreePaths({
			changedPaths: ["dist"],
			knownPaths: new Set(["dist/"]),
			deferredDirectories: new Set(["dist"]),
			listDirectory,
		});

		expect(listDirectory).toHaveBeenCalledTimes(1);
		expect(listDirectory).toHaveBeenCalledWith("");
		expect(result.operations).toEqual([]);
	});

	it("removes a deleted directory and its known descendants locally", async () => {
		const listDirectory = vi.fn(async () => [file("README.md")]);
		const result = await reconcileFileTreePaths({
			changedPaths: ["src"],
			knownPaths: new Set([
				"src/",
				"src/app.ts",
				"src/components/",
				"src/components/button.tsx",
				"README.md",
			]),
			listDirectory,
		});

		expect(result.operations).toEqual([
			{ type: "remove", path: "src/app.ts" },
			{ type: "remove", path: "src/components/button.tsx" },
			{ type: "remove", path: "src/components/" },
			{ type: "remove", path: "src/" },
		]);
		expect([...result.paths]).toEqual(["README.md"]);
	});

	it("walks a newly added directory without rescanning unrelated paths", async () => {
		const listDirectory = vi.fn(async (path: string) => {
			if (path === "") return [directory("generated"), file("README.md")];
			if (path === "generated") return [file("generated/result.ts")];
			return [];
		});
		const result = await reconcileFileTreePaths({
			changedPaths: ["generated"],
			knownPaths: new Set(["README.md"]),
			listDirectory,
		});

		expect(listDirectory.mock.calls).toEqual([[""], ["generated"]]);
		expect(result.operations).toEqual([
			{ type: "add", path: "generated/" },
			{ type: "add", path: "generated/result.ts" },
		]);
	});

	it("surfaces transient listing failures so the caller can retry", async () => {
		await expect(
			reconcileFileTreePaths({
				changedPaths: ["src/index.ts"],
				knownPaths: new Set(["src/", "src/index.ts"]),
				listDirectory: async () => {
					throw new Error("filesystem busy");
				},
			}),
		).rejects.toThrow("filesystem busy");
	});
});

describe("file tree snapshot mutations", () => {
	it("refreshes deferred children, removes stale subtrees and preserves surviving descendants", () => {
		const before = new Set([
			"dist/old/",
			"dist/old/stale.js",
			"dist/keep/",
			"dist/keep/live.js",
			"dist/changed/",
			"dist/changed/nested.js",
			"dist/deleted.js",
			"other/file.js",
		]);
		const next = deferredDirectoryPaths(before, "dist", [
			directory("dist/keep"),
			file("dist/changed"),
			file("dist/new.js"),
		]);
		const model = new FileTree({ paths: ["dist/", ...before] });
		model.batch(fileTreeSnapshotOperations(before, next));
		expect(model.getItem("dist/old/")).toBeNull();
		expect(model.getItem("dist/old/stale.js")).toBeNull();
		expect(model.getItem("dist/deleted.js")).toBeNull();
		expect(model.getItem("dist/changed")?.isDirectory()).toBe(false);
		expect(model.getItem("dist/new.js")).not.toBeNull();
		expect(model.getItem("dist/keep/live.js")).not.toBeNull();
		expect(model.getItem("other/file.js")).not.toBeNull();
		model.cleanUp();
	});
	it.each([
		{
			before: [
				"target/",
				"target/debug/",
				"target/debug/deps/",
				"target/debug/deps/rmetaPSTA5C/",
				"target/debug/deps/rmetaPSTA5C/lib.rmeta",
			],
			after: ["target/", "target/debug/", "target/debug/deps/"],
		},
		{ before: ["entry/", "entry/child.txt"], after: ["entry"] },
		{ before: ["entry"], after: ["entry/", "entry/child.txt"] },
	])("applies a snapshot without crashing: $before", ({ before, after }) => {
		const model = new FileTree({ paths: [...before, "keep.txt"] });
		model.getItem("keep.txt")?.select();
		model.batch(
			fileTreeSnapshotOperations(new Set([...before, "keep.txt"]), [
				...after,
				"keep.txt",
			]),
		);
		for (const path of after)
			expect(model.getItem(path)?.isDirectory()).toBe(path.endsWith("/"));
		model.setSearch("lib.rmeta");
		expect(model.getSearchMatchingPaths()).toEqual([]);
		expect(model.getItem("keep.txt")).not.toBeNull();
		expect(model.getSelectedPaths()).toEqual(["keep.txt"]);
		model.cleanUp();
	});
});
