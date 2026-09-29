import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	prepare: vi.fn(),
	open: vi.fn(),
	list: vi.fn(),
	close: vi.fn(),
	closePreviews: vi.fn(),
}));

vi.mock("../../src/lib/bridge.ts", () => ({
	getTunnelsBridge: () => ({
		list: mocks.list,
		close: mocks.close,
		closePreviews: mocks.closePreviews,
		open: mocks.open,
	}),
}));

vi.mock("../../src/lib/cloud-ssh-client-bus.ts", () => ({
	prepareCloudWorkspaceSsh: mocks.prepare,
}));

vi.mock("../../src/lib/rpc-client.ts", () => ({
	getLocalEnvironmentId: () => "local",
	isCloudWorkspaceEnvironment: () => true,
}));

import {
	closePreviewPortForwards,
	ensurePortForward,
	ensurePreviewPortForward,
} from "../../src/lib/port-forward-client.ts";

describe("port forward client", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reuses a live localhost forward before refreshing cloud access", async () => {
		mocks.list.mockResolvedValue([
			{ environmentId: "workspace_a", remotePort: 3000, localPort: 31_234 },
		]);
		mocks.open.mockResolvedValue({
			environmentId: "workspace_a",
			remotePort: 3000,
			localPort: 31_234,
		});
		expect(await ensurePortForward("workspace_a", 3000)).toBe(31_234);
		expect(mocks.prepare).not.toHaveBeenCalled();
		expect(mocks.open).toHaveBeenCalledWith({
			environmentId: "workspace_a",
			remotePort: 3000,
			cloudWorkspaceId: "workspace_a",
		});
	});

	it("performs at most one credential-refresh retry", async () => {
		mocks.list.mockResolvedValue([]);
		mocks.prepare.mockResolvedValue({});
		mocks.open
			.mockRejectedValueOnce(new Error("zuse ssh bridge: connection failed"))
			.mockResolvedValueOnce({
				environmentId: "workspace_a",
				remotePort: 3000,
				localPort: 30_000,
			});
		expect(await ensurePortForward("workspace_a", 3000)).toBe(30_000);
		expect(mocks.prepare).toHaveBeenCalledTimes(2);
		expect(mocks.open).toHaveBeenCalledTimes(2);
	});

	it("does not refresh credentials for local port allocation failures", async () => {
		mocks.list.mockResolvedValue([]);
		mocks.prepare.mockResolvedValue({});
		mocks.open.mockRejectedValue(new Error("bind: Address already in use"));
		await expect(ensurePortForward("workspace_a", 3000)).rejects.toThrow(
			"Address already in use",
		);
		expect(mocks.prepare).toHaveBeenCalledTimes(1);
		expect(mocks.open).toHaveBeenCalledTimes(1);
	});
});

it("closes an in-flight forward before disabling completes", async () => {
	vi.resetAllMocks();
	let resolveOpen: (value: {
		environmentId: string;
		remotePort: number;
		localPort: number;
	}) => void = () => {};
	mocks.prepare.mockResolvedValue({});
	mocks.list
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([
			{ environmentId: "disable-race", remotePort: 3001, localPort: 13001 },
		]);
	mocks.open.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveOpen = resolve;
			}),
	);
	const opening = ensurePreviewPortForward("disable-race", 3001, () => true);
	await vi.waitFor(() => expect(mocks.open).toHaveBeenCalled());
	const closing = closePreviewPortForwards("disable-race");
	resolveOpen({
		environmentId: "disable-race",
		remotePort: 3001,
		localPort: 13001,
	});
	await opening;
	await closing;
	expect(mocks.closePreviews).toHaveBeenCalledWith("disable-race");
	expect(mocks.close).not.toHaveBeenCalled();
	expect(mocks.open).toHaveBeenCalledWith(
		expect.objectContaining({ owner: "preview" }),
	);
});
it("does not start a queued forward once disabled", async () => {
	const before = mocks.open.mock.calls.length;
	await expect(
		ensurePreviewPortForward("disabled", 3001, () => false),
	).rejects.toThrow("disabled");
	expect(mocks.open.mock.calls.length).toBe(before);
});
