import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CloudImageBuildHistory } from "../../src/components/settings/cloud-image-build-history.tsx";

describe("CloudImageBuildHistory", () => {
	it("surfaces active and failed image attempts at the top level", () => {
		const markup = renderToStaticMarkup(
			<CloudImageBuildHistory
				builds={[
					{
						buildId: "image-failed",
						state: "failed",
						mode: "update",
						active: false,
						errorCode: "project-syncing-repository-failed",
						logText: "Build failed during syncing-repository.",
						runtimeVersion: "runtime-2",
						configurationDigest: "digest-2",
						repositories: [],
						providers: [],
						createdAt: 100,
						updatedAt: 200,
					},
					{
						buildId: "image-active",
						state: "ready",
						mode: "rebuild",
						active: true,
						runtimeVersion: "runtime-1",
						configurationDigest: "digest-1",
						repositories: [],
						providers: [],
						createdAt: 10,
						updatedAt: 90,
					},
				]}
			/>,
		);

		expect(markup).toContain("Latest build");
		expect(markup).toContain("Previous builds · 1");
		expect(markup).toContain("Image update");
		expect(markup).toContain("Clean rebuild");
		expect(markup).toContain("Active");
		expect(markup).toContain("Failed");
		expect(markup).toContain("Succeeded");
	});
});
