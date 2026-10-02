import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CloudWorkspaceGithub } from "../../src/components/settings/cloud-workspace-github.tsx";

const callbacks = {
	onInstall: () => undefined,
	onManage: () => undefined,
	onRefresh: () => undefined,
	onDisconnect: () => undefined,
};

describe("CloudWorkspaceGithub", () => {
	it("uses the GitHub App as the only repository authentication setup", () => {
		const markup = renderToStaticMarkup(
			<CloudWorkspaceGithub
				status={{ configured: true, installations: [], repositories: [] }}
				loading={false}
				busy={null}
				{...callbacks}
			/>,
		);

		expect(markup).toContain("Install GitHub App");
		expect(markup).toContain("signed and linked to this Zuse account");
		expect(markup).not.toContain("gh auth login");
		expect(markup).toContain("h-7");
		expect(markup).not.toContain("h-11");
	});

	it("shows linked personal or organization installations", () => {
		const markup = renderToStaticMarkup(
			<CloudWorkspaceGithub
				status={{
					configured: true,
					installations: [
						{
							installationId: 123,
							accountLogin: "acme",
							accountType: "Organization",
							repositorySelection: "selected",
							suspended: false,
						},
					],
					repositories: [],
				}}
				loading={false}
				busy={null}
				{...callbacks}
			/>,
		);

		expect(markup).toContain("acme");
		expect(markup).toContain("Organization · selected repositories");
		expect(markup).toContain("Connected");
		expect(markup).toContain("Configure app");
		expect(markup).toContain("Repository access");
		expect(markup).toContain("Refresh");
		expect(markup).toContain("never need to be removed first");
	});
});
