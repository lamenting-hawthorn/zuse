import { beforeEach, expect, it, vi } from "vitest";
import {
	loadOrganizationWorkspaces,
	useOrganizationWorkspaces,
} from "../../src/lib/organization-workspaces.ts";
import { observeRendererAccount } from "../../src/lib/renderer-account.ts";

const request = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/organization-client.ts", () => ({
	runOrganizations: request,
}));

beforeEach(() => {
	observeRendererAccount(null);
	observeRendererAccount("alice");
	request.mockReset().mockResolvedValue([]);
});

it("deduplicates loads and caches only the current account's organizations", async () => {
	const first = loadOrganizationWorkspaces();
	expect(loadOrganizationWorkspaces()).toBe(first);
	await expect(first).resolves.toEqual([]);
	await loadOrganizationWorkspaces();
	expect(request).toHaveBeenCalledOnce();
	observeRendererAccount("bob");
	await loadOrganizationWorkspaces();
	expect(request).toHaveBeenCalledTimes(2);
});

it("does not issue an old account's request after the deferred module loads", async () => {
	const pending = loadOrganizationWorkspaces();
	observeRendererAccount("bob");
	await expect(pending).rejects.toThrow("account changed");
	expect(request).not.toHaveBeenCalled();
	expect(useOrganizationWorkspaces.getState()).toMatchObject({
		organizations: [],
		loading: false,
		error: null,
	});
});
