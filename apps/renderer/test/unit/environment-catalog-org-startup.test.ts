import { EnvironmentId } from "@zuse/contracts";
import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("../../src/lib/runtime-operation-client.ts", () => ({
	runtimeOperationClient: async () => ({
		"connect.describe": () =>
			Effect.succeed({
				environmentId: EnvironmentId.make("personal-laptop"),
				label: "Laptop",
			}),
		"environments.list": () => Effect.succeed({ environments: [] }),
	}),
}));

import { observeRendererAccount } from "../../src/lib/renderer-account.ts";
import { selectRendererWorkspace } from "../../src/lib/renderer-workspace.ts";
import { environmentBelongsToWorkspace } from "../../src/lib/rpc-client.ts";
import { useEnvironmentCatalogStore } from "../../src/store/environment-catalog.ts";
import { useWorkspaceStore } from "../../src/store/workspace.ts";

afterEach(() => {
	observeRendererAccount(null);
	vi.unstubAllGlobals();
});

test("organization startup discovers the laptop without activating its Personal projects", async () => {
	vi.stubGlobal("location", new URL("http://localhost:3000"));
	vi.stubGlobal("window", {});
	observeRendererAccount("test-user");
	selectRendererWorkspace({ kind: "organization", organizationId: "org-test" });
	useWorkspaceStore.setState({
		error: "This environment belongs to another workspace.",
		loading: false,
	});
	useEnvironmentCatalogStore.setState({
		initialized: false,
		initializing: false,
		entries: [],
		initializationError: null,
	});
	await expect(
		useEnvironmentCatalogStore.getState().initialize(),
	).resolves.toBeUndefined();
	expect(useEnvironmentCatalogStore.getState().initialized).toBe(true);
	expect(useEnvironmentCatalogStore.getState().initializationError).toBeNull();
	expect(
		useEnvironmentCatalogStore
			.getState()
			.entries.some((entry) => entry.environmentId === "personal-laptop"),
	).toBe(true);
	expect(environmentBelongsToWorkspace("personal-laptop")).toBe(false);
	expect(useWorkspaceStore.getState().folders).toEqual([]);
	await expect(
		useEnvironmentCatalogStore.getState().activate("personal-laptop"),
	).rejects.toThrow("This environment belongs to another workspace.");
	expect(useWorkspaceStore.getState().loading).toBe(false);
	expect(useWorkspaceStore.getState().error).toBeNull();
});
