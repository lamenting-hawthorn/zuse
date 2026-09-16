import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), protocol: vi.fn() }));
vi.mock("@zuse/client-runtime/connection", async (original) => ({
	...(await original<typeof import("@zuse/client-runtime/connection")>()),
	makeRpcClientSession: mocks.create,
}));
vi.mock("../../src/lib/ws-client-protocol.ts", () => ({
	wsClientProtocolLayer: mocks.protocol,
}));

import { observeRendererAccount } from "../../src/lib/renderer-account.ts";
import {
	acquireRendererRpcSession,
	isCloudWorkspaceEnvironment,
	registerApiEnvironment,
	registerCloudWorkspace,
	registerWebSocketEnvironment,
	removeRendererEnvironment,
} from "../../src/lib/rpc-client.ts";

beforeEach(() => {
	observeRendererAccount(null);
	mocks.create.mockReset();
	mocks.protocol.mockReset();
});

it("reports account closure once even when disposing also closes the socket", async () => {
	observeRendererAccount("first");
	let close!: (event: {
		code: number;
		reason: string;
		wasClean: boolean;
	}) => void;
	mocks.protocol.mockImplementation((_url, options) => {
		close = options.onClose;
	});
	const dispose = vi.fn(async () => {
		close({ code: 1000, reason: "disposed", wasClean: true });
	});
	mocks.create.mockResolvedValue({ client: {}, dispose });
	registerApiEnvironment(
		"close-once",
		"wss://example.test/rpc",
		async () => "unused",
	);
	const onClose = vi.fn();
	await acquireRendererRpcSession("close-once", { onClose });
	observeRendererAccount(null);
	close({ code: 1000, reason: "late close", wasClean: true });
	expect(onClose).toHaveBeenCalledOnce();
	expect(dispose).toHaveBeenCalledOnce();
});

it("closes account sessions once while retaining a manually configured SSH session", async () => {
	observeRendererAccount("first");
	const disposeAccount = vi.fn(async () => undefined);
	const disposeSsh = vi.fn(async () => undefined);
	mocks.create
		.mockResolvedValueOnce({ client: {}, dispose: disposeAccount })
		.mockResolvedValueOnce({ client: {}, dispose: disposeSsh });
	registerApiEnvironment(
		"owned",
		"wss://example.test/rpc",
		async () => "unused",
	);
	registerWebSocketEnvironment("manual", "wss://example.test/ssh");
	const onClose = vi.fn();
	const owned = await acquireRendererRpcSession("owned", { onClose });
	const manual = await acquireRendererRpcSession("manual");
	observeRendererAccount("first");
	expect(disposeAccount).not.toHaveBeenCalled();
	observeRendererAccount("second");
	expect(disposeAccount).toHaveBeenCalledOnce();
	expect(onClose).toHaveBeenCalledOnce();
	expect(disposeSsh).not.toHaveBeenCalled();
	await expect(acquireRendererRpcSession("owned")).rejects.toThrow(
		"not connected",
	);
	await owned.dispose();
	expect(disposeAccount).toHaveBeenCalledOnce();
	await manual.dispose();
	await removeRendererEnvironment("manual");
});

it("rejects a grant refresh that finishes after switching away and back", async () => {
	observeRendererAccount("first");
	const dispose = vi.fn(async () => undefined);
	mocks.create.mockResolvedValue({ client: {}, dispose });
	let resolve!: (url: string) => void;
	const refresh = vi.fn(
		() =>
			new Promise<string>((done) => {
				resolve = done;
			}),
	);
	registerApiEnvironment("refreshing", "wss://example.test/rpc", refresh);
	const initial = await acquireRendererRpcSession("refreshing");
	await initial.dispose();
	const pending = acquireRendererRpcSession("refreshing");
	const rejected = expect(pending).rejects.toThrow(
		"connection account changed",
	);
	await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
	observeRendererAccount("second");
	observeRendererAccount("first");
	resolve("wss://example.test/stale");
	await rejected;
	expect(mocks.create).toHaveBeenCalledOnce();
});

it("disposes a handshake that completes after its account was removed", async () => {
	observeRendererAccount("first");
	const dispose = vi.fn(async () => undefined);
	let resolve!: (session: { client: object; dispose: typeof dispose }) => void;
	mocks.create.mockImplementation(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	registerApiEnvironment(
		"opening",
		"wss://example.test/rpc",
		async () => "unused",
	);
	const pending = acquireRendererRpcSession("opening");
	const rejected = expect(pending).rejects.toThrow(
		"connection account changed",
	);
	await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
	observeRendererAccount(null);
	resolve({ client: {}, dispose });
	await rejected;
	expect(dispose).toHaveBeenCalledOnce();
});

it("removes cloud tickets without letting a delayed old refresh replace a new registration", async () => {
	observeRendererAccount("first");
	const ticket = {
		workspaceId: "cloud-owned",
		wsUrl: "wss://example.test/cloud",
		protocol: "zuse-workspace-v1",
		role: "client" as const,
		generation: 1,
		gatewayEpoch: 1,
		credential: "expired-test-ticket",
		expiresAt: 0,
	};
	let resolve!: (value: typeof ticket) => void;
	const refresh = vi.fn(
		() =>
			new Promise<typeof ticket>((done) => {
				resolve = done;
			}),
	);
	registerCloudWorkspace(ticket.workspaceId, ticket, refresh);
	const pending = acquireRendererRpcSession(ticket.workspaceId);
	const rejected = expect(pending).rejects.toThrow(
		"connection account changed",
	);
	await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
	observeRendererAccount("second");
	expect(isCloudWorkspaceEnvironment(ticket.workspaceId)).toBe(false);
	const currentRefresh = vi.fn(async () => ({
		...ticket,
		credential: "current-test-ticket",
	}));
	registerCloudWorkspace(ticket.workspaceId, ticket, currentRefresh);
	resolve({ ...ticket, expiresAt: Date.now() + 60_000 });
	await rejected;
	const dispose = vi.fn(async () => undefined);
	mocks.create.mockResolvedValue({ client: {}, dispose });
	const current = await acquireRendererRpcSession(ticket.workspaceId);
	expect(currentRefresh).toHaveBeenCalledOnce();
	expect(mocks.create).toHaveBeenCalledOnce();
	observeRendererAccount(null);
	expect(dispose).toHaveBeenCalledOnce();
	await current.dispose();
});
