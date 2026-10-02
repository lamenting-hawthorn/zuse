import { CloudProject, Folder, FolderId } from "@zuse/contracts";
import { describe, expect, test } from "vitest";
import {
	cloudProjectFolders,
	isCloudProjectFolder,
	mergeCloudProjectFolders,
} from "../../src/lib/cloud-project-folders.ts";

const project = CloudProject.make({
	projectId: "zuse",
	repositoryIdentity: "github.com/swarajbachu/zuse",
	repositoryUrl: "https://github.com/swarajbachu/zuse.git",
	displayName: "zuse",
	defaultBranch: "main",
	visibility: "private",
	state: "ready",
	activeBuilds: {},
	latestBuilds: {},
	createdAt: 1,
	updatedAt: 1,
});
const local = Folder.make({
	id: FolderId.make("local-zuse"),
	name: "zuse",
	path: "/repos/zuse",
	addedAt: new Date(1),
});
const origin = {
	host: "github.com",
	owner: "SwarajBachu",
	repo: "Zuse",
	cloneUrl: project.repositoryUrl,
};

describe("cloud project display projection", () => {
	test("shows a configured repository with no local checkout or running chat", () => {
		const merged = mergeCloudProjectFolders([], {}, [project]);
		expect(merged.folders.map((folder) => folder.name)).toEqual(["zuse"]);
		expect(isCloudProjectFolder(merged.folders[0]?.id ?? null)).toBe(true);
		expect(merged.originsByFolder["cloud-project:zuse"]?.cloneUrl).toBe(
			project.repositoryUrl,
		);
	});
	test("keeps a matching local checkout instead of duplicating the repository", () => {
		expect(
			mergeCloudProjectFolders([local], { [local.id]: origin }, [project])
				.folders,
		).toEqual([local]);
	});
	test("does not let filtered-out Personal origins hide an organization repository", () => {
		expect(
			mergeCloudProjectFolders([], { [local.id]: origin }, [project]).folders,
		).toHaveLength(1);
	});
	test("does not duplicate hosted projections or mutate existing folders", () => {
		const hosted = cloudProjectFolders([project]);
		expect(
			mergeCloudProjectFolders(hosted.folders, hosted.originsByFolder, [
				project,
			]).folders,
		).toEqual(hosted.folders);
		const folders = [local];
		expect(
			mergeCloudProjectFolders(folders, {}, [project]).folders,
		).toHaveLength(2);
		expect(folders).toEqual([local]);
	});
	test("removal leaves local folders intact", () => {
		expect(mergeCloudProjectFolders([local], {}, []).folders).toEqual([local]);
		expect(isCloudProjectFolder(local.id)).toBe(false);
	});
});
