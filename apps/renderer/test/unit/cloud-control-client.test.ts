import { Effect } from "effect";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	hosted: true,
	request: vi.fn(),
	desktop: vi.fn(),
}));
vi.mock("../../src/lib/platform-capabilities.ts", () => ({
	isHostedProduct: () => mocks.hosted,
}));
vi.mock("../../src/lib/hosted-connect.ts", () => ({
	hostedAccountRequest: mocks.request,
}));
vi.mock("../../src/lib/rpc-client.ts", () => ({
	getControlPlaneRpcClient: mocks.desktop,
}));

import { getCloudControlClient } from "../../src/lib/cloud-control-client.ts";
import { loadCloudProviders } from "../../src/lib/cloud-workspace-session-cache.ts";
import {
	clearControlPlaneSessionCache,
	runCloudControl,
} from "../../src/lib/control-plane-client.ts";
import { observeRendererAccount } from "../../src/lib/renderer-account.ts";
import { selectRendererWorkspace } from "../../src/lib/renderer-workspace.ts";

beforeEach(() => {
	clearControlPlaneSessionCache();
	mocks.hosted = true;
	mocks.request
		.mockReset()
		.mockImplementation(async () => Response.json({ chats: [] }));
	mocks.desktop.mockReset();
	observeRendererAccount("alice");
	selectRendererWorkspace({ kind: "personal" });
});

it.each([
	[403, "cloud_entitlement_required", "entitlement-required"],
	[403, "cloud_billing_hold", "billing-hold"],
	[403, "cloud_beta_access_required", "beta-access-required"],
	[503, "cloud_beta_access_unavailable", "beta-access-unavailable"],
	[409, "cloud_credential_connection_required", "credential-required"],
	[409, "cloud_branch_in_use:workspace_a", "branch-in-use"],
	[409, "cloud_image_rebuild_required", "project-not-ready"],
	[429, "rate_limited", "provider-unavailable"],
] as const)("preserves actionable API errors (%s, %s)", async (status, error, code) => {
	const client = await getCloudControlClient();
	mocks.request.mockResolvedValueOnce(Response.json({ error }, { status }));
	expect(
		await Effect.runPromise(client["cloud.chats.list"]({}).pipe(Effect.flip)),
	).toMatchObject({ code });
});

it("keeps checkout scoped and discards its URL if the workspace changes", async () => {
	const workspace = { kind: "organization", organizationId: "org_a" } as const;
	selectRendererWorkspace(workspace);
	const response = Promise.withResolvers<Response>();
	mocks.request.mockReturnValueOnce(response.promise);
	const pending = runCloudControl((client) =>
		client["machines.checkout"]({ offerId: "cloud-workspace" }),
	);
	await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
	expect(mocks.request).toHaveBeenCalledWith(
		"/v1/billing/checkout",
		{ offerId: "cloud-workspace" },
		expect.objectContaining({ method: "POST", workspace }),
	);
	selectRendererWorkspace({ kind: "organization", organizationId: "org_b" });
	response.resolve(
		Response.json({ checkoutUrl: "https://billing.example/checkout" }),
	);
	await expect(pending).rejects.toThrow("workspace changed");
	expect(mocks.desktop).not.toHaveBeenCalled();
});

it("treats non-JSON access denials as permission failures", async () => {
	const client = await getCloudControlClient();
	mocks.request.mockResolvedValueOnce(
		new Response("Forbidden", { status: 403 }),
	);
	const request: Effect.Effect<unknown, unknown> =
		client["machines.billingPortal"]();
	expect(await Effect.runPromise(Effect.flip(request))).toMatchObject({
		code: "access-denied",
	});
});

it("warms cloud setup over HTTP and keeps the existing cache partitioned by workspace", async () => {
	mocks.request.mockImplementation(async (_path, _body, options) =>
		Response.json({
			providers: [
				{
					providerId:
						options.workspace.kind === "personal"
							? "personal"
							: options.workspace.organizationId,
					displayName: "Provider",
				},
			],
		}),
	);
	expect((await loadCloudProviders()).providers[0]?.providerId).toBe(
		"personal",
	);
	selectRendererWorkspace({ kind: "organization", organizationId: "org_a" });
	expect((await loadCloudProviders()).providers[0]?.providerId).toBe("org_a");
	selectRendererWorkspace({ kind: "personal" });
	expect((await loadCloudProviders()).providers[0]?.providerId).toBe(
		"personal",
	);
	expect(mocks.request).toHaveBeenCalledTimes(2);
	expect(mocks.desktop).not.toHaveBeenCalled();
});

it("does not expose a late cloud setup result after switching workspaces", async () => {
	const response = Promise.withResolvers<Response>();
	mocks.request.mockReturnValueOnce(response.promise);
	const pending = loadCloudProviders();
	await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
	selectRendererWorkspace({ kind: "organization", organizationId: "org_a" });
	response.resolve(Response.json({ providers: [] }));
	await expect(pending).rejects.toThrow("workspace changed");
});
it("reads the hosted catalog without a paired computer and retains the initiating workspace", async () => {
	const workspace = { kind: "organization", organizationId: "org_a" } as const;
	const client = await getCloudControlClient(workspace);
	selectRendererWorkspace({ kind: "organization", organizationId: "org_b" });
	expect(await Effect.runPromise(client["cloud.chats.list"]({}))).toEqual({
		chats: [],
	});
	expect(mocks.request).toHaveBeenCalledWith(
		"/v1/cloud/chats?",
		undefined,
		expect.objectContaining({ workspace }),
	);
	expect(mocks.desktop).not.toHaveBeenCalled();
});
it("rejects a retained hosted client after the account changes without sending a request", async () => {
	const client = await getCloudControlClient();
	observeRendererAccount("bob");
	expect(
		await Effect.runPromise(client["cloud.chats.list"]({}).pipe(Effect.flip)),
	).toMatchObject({ code: "not-allowed" });
	expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects malformed API responses and denies missing permissions", async () => {
	const client = await getCloudControlClient();
	mocks.request.mockResolvedValueOnce(Response.json({ wrong: [] }));
	expect(
		await Effect.runPromise(client["cloud.chats.list"]({}).pipe(Effect.flip)),
	).toMatchObject({ code: "invalid-request" });
	mocks.request.mockResolvedValueOnce(Response.json({}, { status: 403 }));
	expect(
		await Effect.runPromise(client["cloud.chats.list"]({}).pipe(Effect.flip)),
	).toMatchObject({ code: "access-denied" });
});
it("leaves desktop requests on the existing scoped RPC path", async () => {
	mocks.hosted = false;
	const workspace = { kind: "organization", organizationId: "org_a" } as const;
	const desktop = { marker: "existing-client" };
	mocks.desktop.mockResolvedValue(desktop);
	expect(await getCloudControlClient(workspace)).toBe(desktop);
	expect(mocks.desktop).toHaveBeenCalledWith(workspace);
	expect(mocks.request).not.toHaveBeenCalled();
});

it("writes settings only to the initiating workspace and preserves conflict responses", async () => {
	const workspace = { kind: "organization", organizationId: "org_a" } as const;
	const client = await getCloudControlClient(workspace);
	selectRendererWorkspace({ kind: "organization", organizationId: "org_b" });
	const input = { expectedRevision: 3, values: { branchNamingPrefix: "team" } };
	mocks.request.mockResolvedValueOnce(
		Response.json({ revision: 4, values: input.values }),
	);
	expect(
		await Effect.runPromise(client["cloud.settings.update"](input)),
	).toEqual({ revision: 4, values: input.values });
	expect(mocks.request).toHaveBeenCalledWith(
		"/v1/cloud/settings",
		input,
		expect.objectContaining({ workspace, method: "PUT" }),
	);
	mocks.request.mockResolvedValueOnce(
		Response.json({ error: "workspace_settings_changed" }, { status: 409 }),
	);
	expect(
		await Effect.runPromise(
			client["cloud.settings.update"](input).pipe(Effect.flip),
		),
	).toMatchObject({ code: "conflict" });
	observeRendererAccount("bob");
	expect(
		await Effect.runPromise(client["cloud.settings.get"]().pipe(Effect.flip)),
	).toMatchObject({ code: "not-allowed" });
	expect(mocks.request).toHaveBeenCalledTimes(2);
});
