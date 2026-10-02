import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	dispatch: vi.fn(),
	overlay: vi.fn(),
	retryRetainedConnections: vi.fn(),
	toast: vi.fn(),
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
		dispatch: mocks.dispatch,
		overlay: mocks.overlay,
		retryRetainedConnections: mocks.retryRetainedConnections,
	}),
}));

const { useAuthStore } = await import("../../src/store/auth.ts");

describe("auth store cloud recovery", () => {
	beforeEach(() => {
		mocks.dispatch.mockReset();
		mocks.overlay.mockReset();
		mocks.retryRetainedConnections.mockReset();
		mocks.toast.mockReset();
		useAuthStore.setState({ signingIn: false, error: null });
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
		expect(useAuthStore.getState().error).toBeNull();
	});

	it("does not retry connections when sign-in fails", async () => {
		mocks.dispatch.mockRejectedValue(new Error("sign-in failed"));

		await useAuthStore.getState().signIn();

		expect(mocks.retryRetainedConnections).not.toHaveBeenCalled();
		expect(useAuthStore.getState().error).toBe("sign-in failed");
	});
});
