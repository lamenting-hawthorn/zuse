import type { CloudWorkspaceState } from "@zuse/contracts";
import { describe, expect, it } from "vitest";
import { sessionForkDestinations } from "../../src/lib/session-fork.ts";

describe("session fork destinations", () => {
	it("preserves local tab and worktree forks", () => {
		expect(sessionForkDestinations(null)).toEqual(["tab", "chat"]);
		expect(sessionForkDestinations(null, "chat")).toEqual(["chat"]);
	});
	it("offers boxd tabs and machine forks", () => {
		for (const state of ["ready", "paused"] as const) {
			const cloud = { providerId: "boxd", state };
			expect(sessionForkDestinations(cloud)).toEqual(["tab", "chat"]);
			expect(sessionForkDestinations(cloud, "chat")).toEqual(["chat"]);
		}
	});
	it.each([
		"boat",
		"e2b",
		"unknown",
	])("does not enable cloud forks on %s", (providerId) => {
		expect(sessionForkDestinations({ providerId, state: "ready" })).toEqual([]);
	});
	it.each<CloudWorkspaceState>([
		"archiving",
		"archived",
		"deleting",
		"deleted",
	])("does not offer a session fork on a %s machine", (state) => {
		expect(sessionForkDestinations({ providerId: "boxd", state })).toEqual([]);
	});
});
