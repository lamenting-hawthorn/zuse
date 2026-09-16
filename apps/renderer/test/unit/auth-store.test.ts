import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	dispatch: vi.fn(),
	overlay: vi.fn(),
	retryRetainedConnections: vi.fn(),
	toast: vi.fn(),
	observeAccount: vi.fn(),
	accountSnapshot: vi.fn(),
	restart: vi.fn(),
	hosted: false,
	hostedSignIn: vi.fn(),
	hostedSignOut: vi.fn(),
}));

vi.mock("../../src/lib/hosted-connect.ts", () => ({
	beginHostedSignIn: mocks.hostedSignIn,
	signOutHostedProduct: mocks.hostedSignOut,
}));
vi.mock("../../src/lib/platform-capabilities.ts", () => ({
	isHostedProduct: () => mocks.hosted,
}));

vi.mock("../../src/lib/renderer-account.ts", () => ({
	observeRendererAccount: mocks.observeAccount,
	rendererAccountSnapshot: mocks.accountSnapshot,
}));

vi.mock("../../src/components/ui/toast.tsx", () => ({
	toastManager: { add: mocks.toast },
}));

vi.mock("../../src/lib/auth-client-bus.ts", () => ({
	environmentAuthResourceKey: () => ({
		kind: "environment-auth",
		ref: { environmentId: "local" },
	}),
}));

vi.mock("../../src/lib/rpc-client.ts", () => ({
	LOCAL_ENVIRONMENT_KEY: "local",
}));

vi.mock("../../src/lib/session-timeline-client-bus.ts", () => ({
	getRendererClientBus: () => ({
		snapshot: () => undefined,
		dispatch: mocks.dispatch,
		overlay: mocks.overlay,
		retryRetainedConnections: mocks.retryRetainedConnections,
		restart: mocks.restart,
	}),
}));

const { useAuthStore } = await import("../../src/store/auth.ts");

describe("auth store cloud recovery", () => {
	beforeEach(() => {
		mocks.hosted = false;
		mocks.hostedSignIn.mockReset().mockResolvedValue(undefined);
		mocks.hostedSignOut.mockReset().mockResolvedValue(undefined);
		mocks.dispatch.mockReset();
		mocks.overlay.mockReset();
		mocks.retryRetainedConnections.mockReset();
		mocks.toast.mockReset();
		mocks.observeAccount.mockReset();
		mocks.accountSnapshot
			.mockReset()
			.mockReturnValue({ subject: null, epoch: 1 });
		mocks.restart.mockReset();
		useAuthStore.setState({ signingIn: false, error: null });
	});

	it("keeps hosted sign-in and logout out of the selected server's account RPCs", async () => {
		mocks.hosted = true;
		await useAuthStore.getState().signIn();
		await useAuthStore.getState().signOut();
		expect(mocks.hostedSignIn).toHaveBeenCalledOnce();
		expect(mocks.hostedSignOut).toHaveBeenCalledOnce();
		expect(mocks.dispatch).not.toHaveBeenCalled();
		expect(mocks.overlay).not.toHaveBeenCalled();
	});

	it("retries retained cloud connections after a successful sign-in", async () => {
		mocks.dispatch.mockResolvedValue({
			result: {
				_tag: "SignedIn",
				session: {
					user: { id: "user-1", email: "user@example.test" },
					organizationId: null,
					expiresAt: Date.now() + 300_000,
				},
			},
		});

		await useAuthStore.getState().signIn();

		expect(mocks.retryRetainedConnections).toHaveBeenCalledOnce();
		expect(mocks.observeAccount).toHaveBeenCalledWith("user-1");
		expect(useAuthStore.getState().error).toBeNull();
	});

	it("does not retry connections when sign-in fails", async () => {
		mocks.dispatch.mockRejectedValue(new Error("sign-in failed"));

		await useAuthStore.getState().signIn();

		expect(mocks.retryRetainedConnections).not.toHaveBeenCalled();
		expect(useAuthStore.getState().error).toBe("sign-in failed");
		expect(mocks.observeAccount).not.toHaveBeenCalled();
	});

	it("clears account-bound previews before the logout request finishes", async () => {
		let finish = () => {};
		mocks.dispatch.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = () => resolve({});
				}),
		);
		const logout = useAuthStore.getState().signOut();
		expect(mocks.observeAccount).toHaveBeenCalledWith(null);
		finish();
		await logout;
	});

	it("rechecks authoritative auth after an uncertain logout instead of restoring old state", async () => {
		mocks.dispatch.mockRejectedValue(new Error("connection lost"));
		await useAuthStore.getState().signOut();
		expect(mocks.overlay).toHaveBeenCalledOnce();
		expect(mocks.observeAccount.mock.calls).toEqual([[null]]);
		expect(mocks.restart).toHaveBeenCalledOnce();
		expect(useAuthStore.getState().error).toBe("connection lost");
	});

	it("does not let a failed old logout disturb a newer account", async () => {
		let reject = (_cause: unknown) => {};
		mocks.dispatch.mockImplementation(
			() =>
				new Promise((_resolve, onReject) => {
					reject = onReject;
				}),
		);
		const logout = useAuthStore.getState().signOut();
		mocks.accountSnapshot.mockReturnValue({ subject: "new-account", epoch: 2 });
		reject(new Error("late logout failure"));
		await logout;
		expect(mocks.restart).not.toHaveBeenCalled();
		expect(mocks.overlay).toHaveBeenCalledOnce();
		expect(useAuthStore.getState().error).toBeNull();
	});
});
