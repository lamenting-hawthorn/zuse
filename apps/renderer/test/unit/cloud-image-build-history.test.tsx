import type { CloudAccountImageBuildAttempt } from "@zuse/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { CloudImageBuildHistory } from "../../src/components/settings/cloud-image-build-history.tsx";

const build: CloudAccountImageBuildAttempt = {
	buildId: "build",
	state: "building",
	mode: "update",
	active: false,
	runtimeVersion: "v1",
	configurationDigest: "config",
	repositories: [],
	providers: [],
	createdAt: 1000,
	updatedAt: 7000,
};
const render = (value = build) =>
	renderToStaticMarkup(
		<CloudImageBuildHistory builds={[value]} expandLatest />,
	);
afterEach(() => vi.restoreAllMocks());
test("active duration uses wall time, not the last persisted update", () => {
	vi.spyOn(Date, "now").mockReturnValue(66000);
	expect(render()).toContain("1m 5s");
});
test("finished duration stays fixed", () => {
	vi.spyOn(Date, "now").mockReturnValue(66000);
	expect(render({ ...build, state: "ready" })).toContain("6s");
});
test("snapshot preparation is explicit even before logs arrive", () => {
	expect(render({ ...build, state: "sanitizing" })).toContain(
		"Preparing snapshot",
	);
});
