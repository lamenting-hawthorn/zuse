import { environmentRoute } from "@zuse/client-runtime/environment-scope";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hosted = vi.hoisted(() => ({
	completeHostedSignIn: vi.fn(),
	hostedSignedIn: vi.fn(),
	listHostedEnvironments: vi.fn(),
	registerHostedClient: vi.fn(),
	connectHostedEnvironment: vi.fn(),
}));
const openLink = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/cloud-chat-link.ts", () => ({
	openCloudChatLink: openLink,
}));
vi.mock("../../src/lib/hosted-connect.ts", () => ({
	...hosted,
	beginHostedSignIn: vi.fn(),
	isHostedProduct: () => true,
}));
vi.mock("../../src/lib/rpc-client.ts", () => ({
	retryRendererRpcConnection: vi.fn(),
	subscribeRendererRpcConnection: vi.fn(),
}));

import { resolveHostedAccess } from "../../src/components/browser-access-gate.tsx";

beforeEach(() => {
	vi.resetAllMocks();
	hosted.hostedSignedIn.mockResolvedValue(true);
	hosted.listHostedEnvironments.mockResolvedValue({
		environments: [{ environmentId: "my-computer" }],
	});
});
afterEach(() => vi.unstubAllGlobals());

it("requires sign-in before registering or connecting", async () => {
	hosted.hostedSignedIn.mockResolvedValue(false);
	expect(await resolveHostedAccess("/")).toEqual({ status: "signedOut" });
	expect(hosted.completeHostedSignIn).toHaveBeenCalledOnce();
	expect(hosted.registerHostedClient).not.toHaveBeenCalled();
	expect(hosted.listHostedEnvironments).not.toHaveBeenCalled();
	expect(hosted.connectHostedEnvironment).not.toHaveBeenCalled();
});

it("opens the cloud shell without requiring a paired or online computer", async () => {
	expect(await resolveHostedAccess("/")).toEqual({ status: "ready" });
	expect(hosted.registerHostedClient).toHaveBeenCalledOnce();
	expect(hosted.listHostedEnvironments).not.toHaveBeenCalled();
	expect(hosted.connectHostedEnvironment).not.toHaveBeenCalled();
});

it("verifies explicit computer links before connecting", async () => {
	expect(await resolveHostedAccess(environmentRoute("my-computer"))).toEqual({
		status: "ready",
	});
	expect(hosted.listHostedEnvironments).toHaveBeenCalledOnce();
	expect(hosted.registerHostedClient).toHaveBeenCalledOnce();
	expect(hosted.connectHostedEnvironment).toHaveBeenCalledWith("my-computer");
});

it("rejects links to computers outside the account", async () => {
	expect(
		await resolveHostedAccess(environmentRoute("other-computer")),
	).toMatchObject({
		status: "error",
	});
	expect(hosted.registerHostedClient).not.toHaveBeenCalled();
	expect(hosted.connectHostedEnvironment).not.toHaveBeenCalled();
});

it("does not report readiness if registration or connection fails", async () => {
	hosted.registerHostedClient.mockRejectedValueOnce(
		new Error("registration failed"),
	);
	await expect(resolveHostedAccess("/")).rejects.toThrow("registration failed");
	hosted.connectHostedEnvironment.mockRejectedValueOnce(new Error("offline"));
	await expect(
		resolveHostedAccess(environmentRoute("my-computer")),
	).rejects.toThrow("offline");
});

it("resolves authenticated cloud links without pairing and waits for access verification", async () => {
	const path = "/w/organization/org_a/chat/cloud_a";
	expect(await resolveHostedAccess(path)).toEqual({ status: "ready" });
	expect(openLink).toHaveBeenCalledWith(path);
	expect(hosted.registerHostedClient).toHaveBeenCalledOnce();
	expect(hosted.listHostedEnvironments).not.toHaveBeenCalled();
	expect(hosted.connectHostedEnvironment).not.toHaveBeenCalled();
	openLink.mockRejectedValueOnce(new Error("chat_link_unavailable"));
	await expect(resolveHostedAccess(path)).rejects.toThrow(
		"chat_link_unavailable",
	);
});

it.each([
	"/w/organization/org_a/chat/cloud_a",
	"/e/my-computer",
])("opens the restored return path after sign-in: %s", async (pathname) => {
	hosted.completeHostedSignIn.mockResolvedValueOnce(true);
	vi.stubGlobal("window", { location: { pathname } });
	expect(await resolveHostedAccess("/auth/callback")).toEqual({
		status: "ready",
	});
	if (pathname.startsWith("/w/")) {
		expect(openLink).toHaveBeenCalledWith(pathname);
		expect(hosted.connectHostedEnvironment).not.toHaveBeenCalled();
	} else {
		expect(hosted.connectHostedEnvironment).toHaveBeenCalledWith("my-computer");
		expect(openLink).not.toHaveBeenCalled();
	}
});
