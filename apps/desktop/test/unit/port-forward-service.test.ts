import { EventEmitter } from "node:events";
import type { TunnelHandle } from "@zuse/ssh";
import { describe, expect, it } from "vitest";

import {
	PortForwardManager,
	type PortForwardTarget,
	retryableLocalBindFailure,
} from "../../src/tunnels/port-forward-service.ts";

const sshTarget: PortForwardTarget = {
	kind: "ssh",
	target: { alias: "devbox", hostname: "devbox", username: null, port: null },
};

type FakeProcess = EventEmitter & {
	exitCode: number | null;
	signalCode: NodeJS.Signals | null;
};

const fakeTunnel = (
	localPort: number,
	remotePort: number,
): { handle: TunnelHandle; process: FakeProcess; closed: () => boolean } => {
	const process = Object.assign(new EventEmitter(), {
		exitCode: null,
		signalCode: null,
	}) as FakeProcess;
	let closed = false;
	const handle = {
		localPort,
		remotePort,
		process,
		wsBaseUrl: `ws://127.0.0.1:${localPort}/rpc`,
		close: async () => {
			closed = true;
			process.exitCode = 0;
			process.emit("exit", 0, null);
		},
	} as unknown as TunnelHandle;
	return { handle, process, closed: () => closed };
};

describe("PortForwardManager", () => {
	it("retries port bind failures but not SSH access failures", () => {
		expect(retryableLocalBindFailure(new Error("bind failed"))).toBe(true);
		expect(
			retryableLocalBindFailure(new Error("zuse ssh bridge: access rejected")),
		).toBe(false);
	});

	it("prefers the remote port locally and is idempotent while alive", async () => {
		const opened: number[] = [];
		const manager = new PortForwardManager(
			async (input) => {
				opened.push(input.localPort);
				return fakeTunnel(input.localPort, input.remotePort).handle;
			},
			async () => true,
		);
		const first = await manager.open({
			environmentId: "env-a",
			target: sshTarget,
			remotePort: 3000,
		});
		const second = await manager.open({
			environmentId: "env-a",
			target: sshTarget,
			remotePort: 3000,
		});
		expect(first).toEqual({
			environmentId: "env-a",
			remotePort: 3000,
			localPort: 3000,
		});
		expect(second).toBe(first);
		expect(opened).toEqual([3000]);
	});

	it("falls back to a random local port when the preferred one is taken", async () => {
		const manager = new PortForwardManager(
			async (input) => fakeTunnel(input.localPort, input.remotePort).handle,
			async (port) => port !== 3000,
		);
		const forward = await manager.open({
			environmentId: "env-a",
			target: sshTarget,
			remotePort: 3000,
		});
		expect(forward.localPort).not.toBe(3000);
		expect(forward.localPort).toBeGreaterThanOrEqual(20_000);
	});

	it("retries once on a random port when the preferred bind is lost", async () => {
		const attempts: number[] = [];
		const manager = new PortForwardManager(
			async (input) => {
				attempts.push(input.localPort);
				if (attempts.length === 1) throw new Error("bind failed");
				return fakeTunnel(input.localPort, input.remotePort).handle;
			},
			async () => true,
		);
		const forward = await manager.open({
			environmentId: "env-a",
			target: sshTarget,
			remotePort: 3000,
		});
		expect(attempts[0]).toBe(3000);
		expect(forward.localPort).not.toBe(3000);
	});

	it("bounds verified allocation retries across repeated port collisions", async () => {
		const attempts: number[] = [];
		let candidate = 20_000;
		const manager = new PortForwardManager(
			async (input) => {
				attempts.push(input.localPort);
				throw new Error("bind failed");
			},
			async () => true,
			() => candidate++,
		);
		await expect(
			manager.open({
				environmentId: "env-a",
				target: sshTarget,
				remotePort: 3000,
			}),
		).rejects.toThrow("bind failed");
		expect(attempts).toEqual([3000, 20_000, 20_001, 20_002, 20_003]);
	});

	it("evicts dead tunnels and reopens on the next request", async () => {
		let openCount = 0;
		const processes: FakeProcess[] = [];
		const manager = new PortForwardManager(
			async (input) => {
				openCount += 1;
				const tunnel = fakeTunnel(input.localPort, input.remotePort);
				processes.push(tunnel.process);
				return tunnel.handle;
			},
			async () => true,
		);
		await manager.open({
			environmentId: "env-a",
			target: sshTarget,
			remotePort: 3000,
		});
		processes.at(-1)?.emit("exit", 1, null);
		expect(manager.list("env-a")).toEqual([]);
		await manager.open({
			environmentId: "env-a",
			target: sshTarget,
			remotePort: 3000,
		});
		expect(openCount).toBe(2);
	});

	it("closes every forward that belongs to an environment", async () => {
		const manager = new PortForwardManager(
			async (input) => fakeTunnel(input.localPort, input.remotePort).handle,
			async () => true,
		);
		await manager.open({
			environmentId: "env-a",
			target: sshTarget,
			remotePort: 3000,
		});
		await manager.open({
			environmentId: "env-a",
			target: sshTarget,
			remotePort: 8080,
		});
		await manager.open({
			environmentId: "env-b",
			target: sshTarget,
			remotePort: 5173,
		});
		await manager.closeForEnvironment("env-a");
		expect(manager.list("env-a")).toEqual([]);
		expect(manager.list("env-b")).toHaveLength(1);
		await manager.closeAll();
		expect(manager.list()).toEqual([]);
	});

	it("closes an in-flight forward when its environment disconnects", async () => {
		let resolveOpen: (handle: TunnelHandle) => void = () => undefined;
		let markOpenStarted: () => void = () => undefined;
		const openStarted = new Promise<void>((resolve) => {
			markOpenStarted = resolve;
		});
		const tunnel = fakeTunnel(3000, 3000);
		const manager = new PortForwardManager(
			() =>
				new Promise<TunnelHandle>((resolve) => {
					resolveOpen = resolve;
					markOpenStarted();
				}),
			async () => true,
		);
		const opening = manager.open({
			environmentId: "env-a",
			target: sshTarget,
			remotePort: 3000,
		});
		await openStarted;
		const closing = manager.closeForEnvironment("env-a");
		resolveOpen(tunnel.handle);
		await closing;
		await expect(opening).rejects.toThrow("closed before it became ready");
		expect(tunnel.closed()).toBe(true);
		expect(manager.list("env-a")).toEqual([]);
	});
});

it.each([
	false,
	true,
])("preview cleanup preserves shared tunnels (preview first: %s)", async (previewFirst) => {
	const tunnel = fakeTunnel(3001, 3001);
	const manager = new PortForwardManager(
		async () => tunnel.handle,
		async () => true,
	);
	const input = {
		environmentId: "shared",
		remotePort: 3001,
		target: sshTarget,
	};
	await manager.open({
		...input,
		...(previewFirst ? { owner: "preview" as const } : {}),
	});
	await manager.open({
		...input,
		...(previewFirst ? {} : { owner: "preview" as const }),
	});
	await manager.closePreviews("shared");
	expect(tunnel.closed()).toBe(false);
	expect(manager.list("shared")).toHaveLength(1);
});

it("preview cleanup closes only its own tunnels in the requested workspace", async () => {
	const tunnels = new Map<number, ReturnType<typeof fakeTunnel>>();
	const manager = new PortForwardManager(
		async (input) => {
			const tunnel = fakeTunnel(input.localPort, input.remotePort);
			tunnels.set(input.remotePort, tunnel);
			return tunnel.handle;
		},
		async () => true,
	);
	await manager.open({
		environmentId: "a",
		target: sshTarget,
		remotePort: 3001,
		owner: "preview",
	});
	await manager.open({
		environmentId: "a",
		target: sshTarget,
		remotePort: 3002,
	});
	await manager.open({
		environmentId: "b",
		target: sshTarget,
		remotePort: 3003,
		owner: "preview",
	});
	await manager.closePreviews("a");
	expect(tunnels.get(3001)?.closed()).toBe(true);
	expect(tunnels.get(3002)?.closed()).toBe(false);
	expect(tunnels.get(3003)?.closed()).toBe(false);
});

it("a manual borrower preserves an in-flight preview tunnel during cleanup", async () => {
	const tunnel = fakeTunnel(3001, 3001);
	let finish!: (handle: TunnelHandle) => void;
	const manager = new PortForwardManager(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
		async () => true,
	);
	const input = {
		environmentId: "pending",
		target: sshTarget,
		remotePort: 3001,
	};
	const preview = manager.open({ ...input, owner: "preview" });
	const manual = manager.open(input);
	await manager.closePreviews("pending");
	finish(tunnel.handle);
	await Promise.all([preview, manual]);
	expect(tunnel.closed()).toBe(false);
});

it("preview cleanup also cancels its exclusive pending open", async () => {
	const tunnel = fakeTunnel(3001, 3001);
	let finish!: (handle: TunnelHandle) => void;
	const manager = new PortForwardManager(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
		async () => true,
	);
	const opening = manager.open({
		environmentId: "exclusive",
		target: sshTarget,
		remotePort: 3001,
		owner: "preview",
	});
	const rejected = expect(opening).rejects.toThrow(
		"closed before it became ready",
	);
	await Promise.resolve();
	const closing = manager.closePreviews("exclusive");
	finish(tunnel.handle);
	await rejected;
	await closing;
	expect(tunnel.closed()).toBe(true);
	expect(manager.list()).toEqual([]);
});
