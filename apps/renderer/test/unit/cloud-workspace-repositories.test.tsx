import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CloudWorkspaceRepositories } from "../../src/components/settings/cloud-workspace-repositories.tsx";

describe("CloudWorkspaceRepositories", () => {
	it("renders selected repositories as removable avatar rows", () => {
		const markup = renderToStaticMarkup(
			<CloudWorkspaceRepositories
				projects={[
					{
						projectId: "project-1",
						repositoryIdentity: "github.com/acme/app",
						repositoryUrl: "https://github.com/acme/app",
						displayName: "acme/app",
						defaultBranch: "main",
						visibility: "private",
						state: "connected",
						activeBuilds: {},
						latestBuilds: {},
						createdAt: 1,
						updatedAt: 1,
					},
				]}
				repositories={[
					{
						nameWithOwner: "acme/app",
						description: "Example",
						sshUrl: "git@github.com:acme/app.git",
						httpsUrl: "https://github.com/acme/app",
						isPrivate: true,
						defaultBranch: "main",
						updatedAt: new Date(1),
					},
				]}
				githubAuthenticated
				loading={false}
				busy={null}
				error={null}
				onRefresh={() => undefined}
				onAdd={() => undefined}
				onRemove={() => undefined}
			/>,
		);

		expect(markup).toContain("Repositories");
		expect(markup).toContain("acme/app");
		expect(markup).toContain('aria-label="acme avatar"');
		expect(markup).toContain("size-6");
		expect(markup).toContain('aria-label="Remove acme/app"');
		expect(markup).toContain("selected for cloud image");
		expect(markup).toContain("h-7");
		expect(markup).not.toContain("min-h-8");
		expect(markup).not.toContain("min-h-11");
	});
});
