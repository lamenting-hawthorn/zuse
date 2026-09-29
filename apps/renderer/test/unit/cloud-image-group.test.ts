import type { CloudAccountImage } from "@zuse/contracts";
import { expect, it, vi } from "vitest";
import {
	cloudImageGroupStatus,
	rebuildCloudImages,
} from "../../src/lib/cloud-image-group.ts";

const image = (
	providerId: string,
	state: CloudAccountImage["state"],
): CloudAccountImage => ({
	providerId,
	state,
	repositories: [],
	providers: [],
	builds: [],
	updatedAt: 1,
});

it("requires every available provider, including newly added ones, to be ready", () => {
	const images = [image("boxd", "ready")];
	expect(cloudImageGroupStatus(["boxd"], images)?.state).toBe("ready");
	expect(cloudImageGroupStatus(["boxd", "new"], images)).toBeNull();
	expect(
		cloudImageGroupStatus(
			["boxd", "new"],
			[...images, image("new", "not-built")],
		)?.state,
	).toBe("not-built");
	expect(
		cloudImageGroupStatus(["boxd", "new"], [...images, image("new", "ready")])
			?.state,
	).toBe("ready");
	expect(cloudImageGroupStatus([], images)).toBeNull();
});
it("keeps remaining builds visible and reports a partial failure after they finish", () => {
	expect(
		cloudImageGroupStatus(
			["boxd", "e2b"],
			[image("boxd", "failed"), image("e2b", "building")],
		)?.state,
	).toBe("building");
	expect(
		cloudImageGroupStatus(
			["boxd", "e2b"],
			[image("boxd", "failed"), image("e2b", "ready")],
		)?.state,
	).toBe("failed");
	expect(
		cloudImageGroupStatus(
			["e2b"],
			[image("boxd", "failed"), image("e2b", "ready")],
		)?.state,
	).toBe("ready");
});
it("requests each provider once and preserves accepted builds when another fails", async () => {
	const build = vi.fn(async (id: string) => {
		if (id === "e2b") throw new Error("offline");
		return image(id, "building");
	});
	const result = await rebuildCloudImages(
		["boxd", "e2b", "boat", "boxd"],
		build,
	);
	expect(build.mock.calls.map(([id]) => id)).toEqual(["boxd", "e2b", "boat"]);
	expect(result.images.map((item) => item.providerId)).toEqual([
		"boxd",
		"boat",
	]);
	expect(result.failedProviderIds).toEqual(["e2b"]);
});
