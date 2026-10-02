import {
	type CloudProject,
	Folder,
	FolderId,
	type GitOriginInfo,
} from "@zuse/contracts";

export const cloudProjectFolderId = (projectId: string): FolderId =>
	FolderId.make(`cloud-project:${projectId}`);
export const isCloudProjectFolder = (id: FolderId | null): boolean =>
	id?.startsWith("cloud-project:") === true;

/** Display projection only: a cloud repository is not a local checkout. */
export const cloudProjectFolders = (projects: ReadonlyArray<CloudProject>) => ({
	folders: projects.map((project) =>
		Folder.make({
			id: cloudProjectFolderId(project.projectId),
			name: project.displayName,
			path: project.repositoryUrl,
			addedAt: new Date(project.createdAt),
		}),
	),
	originsByFolder: Object.fromEntries(
		projects.map((project) => {
			const [host, owner, ...repo] = project.repositoryIdentity.split("/");
			return [
				cloudProjectFolderId(project.projectId),
				{
					host: host ?? "github.com",
					owner: owner ?? "",
					repo: repo.join("/"),
					cloneUrl: project.repositoryUrl,
				},
			];
		}),
	),
});

export const mergeCloudProjectFolders = (
	folders: ReadonlyArray<Folder>,
	origins: Readonly<Record<string, GitOriginInfo | null>>,
	projects: ReadonlyArray<CloudProject>,
) => {
	const identities = new Set(
		folders
			.map((folder) => origins[folder.id])
			.flatMap((origin) =>
				origin
					? [`${origin.host}/${origin.owner}/${origin.repo}`.toLowerCase()]
					: [],
			),
	);
	const ids = new Set(folders.map((folder) => folder.id));
	const cloud = cloudProjectFolders(
		projects.filter(
			(project) =>
				!identities.has(project.repositoryIdentity.toLowerCase()) &&
				!ids.has(cloudProjectFolderId(project.projectId)),
		),
	);
	return {
		folders: [...folders, ...cloud.folders],
		originsByFolder: {
			...Object.fromEntries(
				folders.map((folder) => [folder.id, origins[folder.id] ?? null]),
			),
			...cloud.originsByFolder,
		},
	};
};
