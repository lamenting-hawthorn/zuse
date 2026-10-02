import { describe, expect, test } from "vitest";

import {
	cloudChatRoute,
	environmentRoute,
	parseCloudChatRoute,
	parseEnvironmentRoute,
	scopedCacheKey,
} from "../../src/environment-scope.ts";

test("cloud links round-trip explicit workspace ownership without an access token", () => {
	for (const scope of [
		{ kind: "personal" } as const,
		{ kind: "organization", organizationId: "org_a" } as const,
	]) {
		const link = { scope, workspaceId: "chat /?&" };
		expect(parseCloudChatRoute(cloudChatRoute(link))).toEqual(link);
	}
});

test.each([
	"/w/personal/chat/",
	"/w/organization/chat/id",
	"/w/personal/chat/%",
	"/w/personal/chat/id/extra",
	"/e/computer/chat/id",
])("does not accept malformed cloud links: %s", (path) => {
	expect(parseCloudChatRoute(path)).toBeNull();
});

describe("environment scope", () => {
	test("round trips hosted environment routes", () => {
		expect(environmentRoute("env/a", { threadId: "thread b" })).toBe(
			"/e/env%2Fa/chat/thread%20b",
		);
		expect(parseEnvironmentRoute("/e/env%2Fa/chat/thread%20b")).toEqual({
			environmentId: "env/a",
			kind: "chat",
			resourceId: "thread b",
		});
	});

	test("requires environment identity in cache keys", () => {
		expect(scopedCacheKey("env_one", "project", "same-id")).toBe(
			"env_one:project:same-id",
		);
		expect(scopedCacheKey("env_two", "project", "same-id")).toBe(
			"env_two:project:same-id",
		);
	});

	test("does not treat unscoped paths as a remote environment", () => {
		expect(parseEnvironmentRoute("/chat/thread")).toBeNull();
	});
});
