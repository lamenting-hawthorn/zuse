import { makeResourceKey } from "@zuse/client-runtime/resource-ref";
import { EnvironmentId } from "@zuse/contracts";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	write: vi.fn(),
	hosted: false,
}));
vi.mock("../../src/lib/platform-capabilities.ts", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../../src/lib/platform-capabilities.ts")
	>()),
	isHostedProduct: () => mocks.hosted,
	rendererPlatformCapabilities: () => ({ desktop: !mocks.hosted }),
}));
vi.mock("../../src/lib/cloud-control-client.ts", () => ({
	getCloudControlClient: async () => ({
		"cloud.settings.get": mocks.read,
		"cloud.settings.update": mocks.write,
	}),
}));

import { useBrowserDevicePreferences } from "../../src/lib/browser-device-preferences.ts";
import { useOrganizationWorkspaces } from "../../src/lib/organization-workspaces.ts";
import { observeRendererAccount } from "../../src/lib/renderer-account.ts";
import { selectRendererWorkspace } from "../../src/lib/renderer-workspace.ts";
import { getLocalEnvironmentId } from "../../src/lib/rpc-client.ts";
import {
	getRendererClientBus,
	resetSessionTimelineClientBusForTest,
} from "../../src/lib/session-timeline-client-bus.ts";
import {
	resolveEnvironmentSettings,
	type SettingsSlice,
	useSettingsStore,
} from "../../src/lib/settings-client-bus.ts";
import { loadWorkspaceSettings } from "../../src/lib/workspace-settings-client.ts";

beforeEach(() => {
	vi.stubEnv("VITE_ORGANIZATION_WORKSPACES", "true");
	mocks.hosted = false;
	useBrowserDevicePreferences.setState({}, true);
	observeRendererAccount(null);
	observeRendererAccount("alice");
	mocks.read.mockReset().mockReturnValue(
		Effect.succeed({
			revision: 1,
			values: {
				branchNamingPrefix: "team",
				defaultRuntimeMode: "approval-required",
			},
		}),
	);
	mocks.write.mockReset().mockImplementation((input) =>
		Effect.succeed({
			revision: input.expectedRevision + 1,
			values: input.values,
		}),
	);
});
afterEach(() => {
	resetSessionTimelineClientBusForTest();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

it("keeps device appearance but excludes Personal agent settings and host paths in an organization", async () => {
	const personal = {
		...useSettingsStore.getState(),
		appearanceMode: "light" as const,
		branchNamingPrefix: "personal",
		defaultRuntimeMode: "full-access" as const,
		providerBinaryPaths: { claude: "/personal/agent" },
	};
	const key = makeResourceKey<SettingsSlice>("environment-settings", {
		environmentId: EnvironmentId.make(getLocalEnvironmentId()),
	});
	const bus = getRendererClientBus();
	bus.snapshot(key);
	bus.overlay(key, { initialData: personal, update: () => personal });
	selectRendererWorkspace({ kind: "organization", organizationId: "org_a" });
	expect(useSettingsStore.getState()).toMatchObject({
		loaded: false,
		appearanceMode: "light",
		branchNamingPrefix: "",
		defaultRuntimeMode: "approval-required",
	});
	expect(useSettingsStore.getState().providerBinaryPaths).toBeUndefined();
	await loadWorkspaceSettings();
	expect(useSettingsStore.getState()).toMatchObject({
		loaded: true,
		appearanceMode: "light",
		branchNamingPrefix: "team",
	});
	expect(
		await resolveEnvironmentSettings(EnvironmentId.make("unrelated-runtime")),
	).toMatchObject({
		branchNamingPrefix: "team",
		defaultRuntimeMode: "approval-required",
	});
	selectRendererWorkspace({ kind: "personal" });
	expect(useSettingsStore.getState()).toMatchObject({
		branchNamingPrefix: "personal",
		defaultRuntimeMode: "full-access",
		providerBinaryPaths: { claude: "/personal/agent" },
	});
	await loadWorkspaceSettings();
	expect(useSettingsStore.getState()).toMatchObject({
		branchNamingPrefix: "team",
		defaultRuntimeMode: "approval-required",
		providerBinaryPaths: { claude: "/personal/agent" },
		appearanceMode: "light",
	});
});

it("uses shared Personal values without writing them into the runtime settings file", async () => {
	const key = makeResourceKey<SettingsSlice>("environment-settings", {
		environmentId: EnvironmentId.make(getLocalEnvironmentId()),
	});
	const personal = {
		...useSettingsStore.getState(),
		branchNamingPrefix: "legacy",
	};
	const bus = getRendererClientBus();
	bus.snapshot(key);
	bus.overlay(key, { initialData: personal, update: () => personal });
	await loadWorkspaceSettings();
	const dispatch = vi.spyOn(bus, "dispatch");
	useSettingsStore.getState().setBranchNamingPrefix("account-personal");
	await vi.waitFor(() =>
		expect(useSettingsStore.getState().branchNamingPrefix).toBe(
			"account-personal",
		),
	);
	expect(bus.snapshot(key).data?.branchNamingPrefix).toBe("legacy");
	expect(dispatch).not.toHaveBeenCalled();
	dispatch.mockRestore();
});

it("keeps native host configuration and signed-out edits on the existing local path", async () => {
	await loadWorkspaceSettings();
	const dispatch = vi
		.spyOn(getRendererClientBus(), "dispatch")
		.mockRejectedValue(new Error("simulated local failure"));
	try {
		useSettingsStore.getState().setProviderBinaryPath("codex", "/local/codex");
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "settings.update",
				payload: {
					patch: {
						providerBinaryPaths: expect.objectContaining({
							codex: "/local/codex",
						}),
					},
				},
			}),
		);
		observeRendererAccount(null);
		useSettingsStore.getState().setBranchNamingPrefix("signed-out");
		expect(dispatch).toHaveBeenLastCalledWith(
			expect.objectContaining({
				kind: "settings.update",
				payload: { patch: { branchNamingPrefix: "signed-out" } },
			}),
		);
		expect(mocks.write).not.toHaveBeenCalled();
		await Promise.resolve();
	} finally {
		dispatch.mockRestore();
	}
});

it("routes the existing settings actions to scoped settings without modifying a runtime", async () => {
	selectRendererWorkspace({ kind: "organization", organizationId: "org_a" });
	await loadWorkspaceSettings();
	const dispatch = vi.spyOn(getRendererClientBus(), "dispatch");
	useSettingsStore.getState().setBranchNamingPrefix("new-team");
	await vi.waitFor(() =>
		expect(useSettingsStore.getState().branchNamingPrefix).toBe("new-team"),
	);
	expect(mocks.write).toHaveBeenCalledWith({
		expectedRevision: 1,
		values: {
			branchNamingPrefix: "new-team",
			defaultRuntimeMode: "approval-required",
		},
	});
	expect(dispatch).not.toHaveBeenCalled();
	dispatch.mockRestore();
});

it("does not require content settings to render the finance-only workspace shell", async () => {
	const personal = {
		...useSettingsStore.getState(),
		branchNamingPrefix: "private-personal",
	};
	const key = makeResourceKey<SettingsSlice>("environment-settings", {
		environmentId: EnvironmentId.make(getLocalEnvironmentId()),
	});
	const bus = getRendererClientBus();
	bus.snapshot(key);
	bus.overlay(key, { initialData: personal, update: () => personal });
	useOrganizationWorkspaces.setState({
		organizations: [{ id: "org_a", name: "Finance", role: "billing" }],
	});
	selectRendererWorkspace({ kind: "organization", organizationId: "org_a" });
	expect(useSettingsStore.getState()).toMatchObject({
		loaded: true,
		branchNamingPrefix: "",
	});
	await expect(
		resolveEnvironmentSettings(EnvironmentId.make("local")),
	).rejects.toThrow("content access");
	expect(mocks.read).not.toHaveBeenCalled();
});

it("hydrates hosted Personal settings without runtime access and stores device choices only in the browser", async () => {
	mocks.hosted = true;
	const setItem = vi.fn();
	vi.stubGlobal("window", { localStorage: { setItem } });
	const dispatch = vi.spyOn(getRendererClientBus(), "dispatch");
	expect(useSettingsStore.getState().loaded).toBe(false);
	await loadWorkspaceSettings();
	expect(useSettingsStore.getState()).toMatchObject({
		loaded: true,
		branchNamingPrefix: "team",
	});
	useSettingsStore.getState().setAppearanceMode("light");
	expect(useSettingsStore.getState().appearanceMode).toBe("light");
	expect(setItem).toHaveBeenCalledWith(
		"zuse.browser.device-preferences.v1",
		JSON.stringify({ appearanceMode: "light" }),
	);
	expect(mocks.write).not.toHaveBeenCalled();
	useSettingsStore.getState().setBranchNamingPrefix("personal-cloud");
	await vi.waitFor(() =>
		expect(useSettingsStore.getState().branchNamingPrefix).toBe(
			"personal-cloud",
		),
	);
	expect(
		await resolveEnvironmentSettings(EnvironmentId.make("unconnected")),
	).toMatchObject({ branchNamingPrefix: "personal-cloud" });
	selectRendererWorkspace({ kind: "organization", organizationId: "org_b" });
	expect(useSettingsStore.getState()).toMatchObject({
		loaded: false,
		appearanceMode: "light",
		branchNamingPrefix: "",
	});
	expect(dispatch).not.toHaveBeenCalled();
	dispatch.mockRestore();
});
