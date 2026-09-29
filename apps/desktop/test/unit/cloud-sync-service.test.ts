import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import {
	CloudSyncManager,
	cloudSyncDefaultPath,
	prepareCloudSyncDefaultPath,
	SYNC_MARKER_FILE,
} from "../../src/sync/cloud-sync-service.ts";
import {
	readSyncManifest,
	writeSyncManifest,
} from "../../src/sync/cloud-sync-snapshot.ts";

test("default path cannot escape the managed repository/branch directory", () => {
	expect(
		cloudSyncDefaultPath("/Users/me", "owner/repo.git", "feature/sync"),
	).toBe("/Users/me/.zuse/cloud/repo/feature/sync");
	expect(cloudSyncDefaultPath("/Users/me", "repo", "../escape")).toBeNull();
});

test("refuses unrelated folders and markers belonging to another workspace", async () => {
	const localPath = await mkdtemp(join(tmpdir(), "zuse-guard-"));
	const manager = new CloudSyncManager(() => {});
	const config = {
		workspaceId: "one",
		enabled: true,
		localPath,
		hostAlias: "zuse-one",
		remotePath: "/repo",
	};
	try {
		await writeFile(join(localPath, "precious"), "keep");
		expect((await manager.configure(config)).error).toContain("not empty");
		await writeFile(
			join(localPath, SYNC_MARKER_FILE),
			JSON.stringify({ workspaceId: "two" }),
		);
		expect((await manager.configure(config)).error).toContain(
			"different cloud workspace",
		);
	} finally {
		await manager.dispose();
		await rm(localPath, { recursive: true, force: true });
	}
});

test("archive removes an owned snapshot and cache; unarchive creates a fresh snapshot", async () => {
	const parent = await mkdtemp(join(tmpdir(), "zuse-archive-"));
	const localPath = join(parent, "repo");
	const config = {
		workspaceId: "one",
		enabled: false,
		localPath,
		hostAlias: "zuse-one",
		remotePath: "/repo",
	};
	const manager = new CloudSyncManager(() => {});
	try {
		await mkdir(localPath);
		const file = {
			path: "nested/file",
			hash: createHash("sha256").update("cloud").digest("hex"),
			size: 5,
			mode: 0o644,
		};
		await mkdir(join(localPath, "nested"));
		await writeFile(join(localPath, file.path), "cloud", { mode: file.mode });
		await writeSyncManifest(localPath, {
			version: 1,
			workspaceId: "one",
			files: [file],
		});
		await mkdir(`${localPath}.zuse-sync-cache`);
		await writeSyncManifest(`${localPath}.zuse-sync-cache`, {
			version: 1,
			workspaceId: "one",
			files: [],
		});
		expect(
			(await manager.configure({ ...config, archived: true })).error,
		).toBeNull();
		await expect(stat(localPath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(stat(`${localPath}.zuse-sync-cache`)).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect((await manager.configure({ ...config, enabled: true })).state).toBe(
			"pending",
		);
		expect(await readSyncManifest(localPath, "one")).toMatchObject({
			files: [],
		});
	} finally {
		await manager.dispose();
		await rm(parent, { recursive: true, force: true });
	}
});

test.each([
	"foreign",
	"symlink",
	"pending",
])("archive preserves %s contents", async (kind) => {
	const parent = await mkdtemp(join(tmpdir(), "zuse-archive-guard-"));
	const localPath = join(parent, "repo");
	const manager = new CloudSyncManager(() => {});
	try {
		await mkdir(localPath);
		const file = {
			path: "file",
			hash: createHash("sha256").update("cloud").digest("hex"),
			size: 5,
			mode: 0o644,
		};
		await writeFile(join(localPath, "file"), "cloud");
		await writeSyncManifest(localPath, {
			version: 1,
			workspaceId: kind === "foreign" ? "other" : "one",
			files: [file],
			...(kind === "pending" ? { pending: [file] } : {}),
		});
		if (kind === "symlink") {
			await rename(localPath, join(parent, "target"));
			await symlink(join(parent, "target"), localPath);
		}
		const status = await manager.configure({
			workspaceId: "one",
			enabled: false,
			archived: true,
			localPath,
			hostAlias: "zuse-one",
			remotePath: "",
		});
		expect(status.state).toBe("error");
		expect(await readFile(join(localPath, "file"), "utf8")).toBe("cloud");
	} finally {
		await manager.dispose();
		await rm(parent, { recursive: true, force: true });
	}
});

test("archive joins an in-flight download before cleanup and later configure", async () => {
	const parent = await mkdtemp(join(tmpdir(), "zuse-archive-race-"));
	const localPath = join(parent, "repo");
	let release!: () => void;
	let signal!: AbortSignal;
	const download = vi.fn(
		async (_input, _staging, _baseline, abortSignal: AbortSignal) => {
			signal = abortSignal;
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return [];
		},
	);
	const manager = new CloudSyncManager(() => {}, download);
	const config = {
		workspaceId: "one",
		enabled: true,
		localPath,
		hostAlias: "zuse-one",
		remotePath: "/repo",
	};
	try {
		await manager.configure(config);
		await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
		const archive = manager.configure({
			...config,
			enabled: false,
			archived: true,
		});
		const resume = manager.configure(config);
		await vi.waitFor(() => expect(signal.aborted).toBe(true));
		expect(await stat(localPath)).toBeDefined();
		release();
		expect((await archive).error).toBeNull();
		expect((await resume).state).toBe("pending");
		expect(await readSyncManifest(localPath, "one")).toMatchObject({
			files: [],
		});
	} finally {
		release?.();
		await manager.dispose();
		await rm(parent, { recursive: true, force: true });
	}
});

test("default path lookup preserves manifests and archive lookup does not create folders", async () => {
	const home = await mkdtemp(join(tmpdir(), "zuse-path-"));
	try {
		const path = await prepareCloudSyncDefaultPath(
			home,
			"one",
			"repo",
			"main",
			false,
		);
		if (path === null) throw new Error("Expected a default sync path");
		await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
		await prepareCloudSyncDefaultPath(home, "one", "repo", "main");
		const manifest = {
			version: 1 as const,
			workspaceId: "one",
			files: [],
			pending: [],
		};
		await writeSyncManifest(path, manifest);
		await prepareCloudSyncDefaultPath(home, "one", "repo", "main");
		expect(await readSyncManifest(path, "one")).toEqual(manifest);
		await expect(
			prepareCloudSyncDefaultPath(home, "two", "repo", "main"),
		).rejects.toThrow("different cloud workspace");
		expect(await readSyncManifest(path, "one")).toEqual(manifest);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("ordinary disable keeps the snapshot and archive cleanup is idempotent", async () => {
	const parent = await mkdtemp(join(tmpdir(), "zuse-disable-"));
	const localPath = join(parent, "repo");
	const config = {
		workspaceId: "one",
		enabled: true,
		localPath,
		hostAlias: "zuse-one",
		remotePath: "/repo",
	};
	const manager = new CloudSyncManager(() => {});
	try {
		await manager.configure(config);
		await manager.configure({ ...config, enabled: false, localPath: "" });
		expect(await readSyncManifest(localPath, "one")).toMatchObject({
			files: [],
		});
		for (let attempt = 0; attempt < 2; attempt++) {
			expect(
				(await manager.configure({ ...config, enabled: false, archived: true }))
					.error,
			).toBeNull();
			await expect(stat(localPath)).rejects.toMatchObject({ code: "ENOENT" });
		}
	} finally {
		await manager.dispose();
		await rm(parent, { recursive: true, force: true });
	}
});

test("archive deletes synced files but keeps only local edits and extras, and can sync again", async () => {
	const parent = await mkdtemp(join(tmpdir(), "zuse-archive-partial-"));
	const localPath = join(parent, "repo");
	const config = {
		workspaceId: "one",
		enabled: false,
		localPath,
		hostAlias: "zuse-one",
		remotePath: "/repo",
	};
	const manager = new CloudSyncManager(() => {});
	try {
		await mkdir(join(localPath, "nested"), { recursive: true });
		await mkdir(join(localPath, "empty-after-cleanup"));
		const files = [
			"nested/synced",
			"nested/edited",
			"empty-after-cleanup/synced",
		].map((path) => ({
			path,
			hash: createHash("sha256").update("cloud").digest("hex"),
			size: 5,
			mode: 0o644,
		}));
		for (const file of files)
			await writeFile(
				join(localPath, file.path),
				file.path.endsWith("edited") ? "local" : "cloud",
				{ mode: file.mode },
			);
		await writeFile(join(localPath, "nested/extra"), "keep");
		await symlink(parent, join(localPath, "local-link"));
		await writeSyncManifest(localPath, {
			version: 1,
			workspaceId: "one",
			files,
		});
		await mkdir(`${localPath}.zuse-sync-cache`);
		await writeSyncManifest(`${localPath}.zuse-sync-cache`, {
			version: 1,
			workspaceId: "one",
			files: [],
		});
		for (let attempt = 0; attempt < 2; attempt++) {
			expect(
				(await manager.configure({ ...config, archived: true })).error,
			).toBeNull();
			await expect(
				stat(join(localPath, "nested/synced")),
			).rejects.toMatchObject({ code: "ENOENT" });
			await expect(
				stat(join(localPath, "empty-after-cleanup")),
			).rejects.toMatchObject({ code: "ENOENT" });
			expect(await readFile(join(localPath, "nested/edited"), "utf8")).toBe(
				"local",
			);
			expect(await readFile(join(localPath, "nested/extra"), "utf8")).toBe(
				"keep",
			);
			expect(await readlink(join(localPath, "local-link"))).toBe(parent);
		}
		await expect(stat(`${localPath}.zuse-sync-cache`)).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(
			(await readSyncManifest(localPath, "one")).files.map((file) => file.path),
		).toEqual(["nested/edited"]);
		expect((await manager.configure({ ...config, enabled: true })).state).toBe(
			"pending",
		);
	} finally {
		await manager.dispose();
		await rm(parent, { recursive: true, force: true });
	}
});
