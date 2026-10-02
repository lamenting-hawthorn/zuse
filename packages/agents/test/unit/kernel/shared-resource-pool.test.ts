import { describe, expect, test, vi } from "vitest";

import { createSharedResourcePool } from "../../../src/kernel/shared-resource-pool.ts";

describe("shared resource pool", () => {
	test("coalesces concurrent creation and closes after the last lease is idle", async () => {
		vi.useFakeTimers();
		const close = vi.fn();
		const create = vi.fn(async (key: string) => ({ close, key }));
		const pool = createSharedResourcePool({ create, idleTimeoutMs: 5_000 });

		await expect(
			Promise.all([
				pool.use("default", async (resource) => resource.key),
				pool.use("default", async (resource) => resource.key),
			]),
		).resolves.toEqual(["default", "default"]);
		expect(create).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(4_999);
		await pool.use("default", async () => undefined);
		await vi.advanceTimersByTimeAsync(4_999);
		expect(close).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(close).toHaveBeenCalledOnce();
		vi.useRealTimers();
	});

	test("isolates keys and retries failed creation", async () => {
		const close = vi.fn();
		const create = vi
			.fn<(key: string) => Promise<{ close: () => void; key: string }>>()
			.mockRejectedValueOnce(new Error("startup failed"))
			.mockImplementation(async (key) => ({ close, key }));
		const pool = createSharedResourcePool({ create, idleTimeoutMs: 5_000 });

		await expect(pool.use("a", async () => undefined)).rejects.toThrow(
			"startup failed",
		);
		await expect(pool.use("a", async (resource) => resource.key)).resolves.toBe(
			"a",
		);
		await expect(pool.use("b", async (resource) => resource.key)).resolves.toBe(
			"b",
		);
		expect(create).toHaveBeenCalledTimes(3);
	});

	test("dispose closes all resources and rejects new leases", async () => {
		const closes = new Map<string, ReturnType<typeof vi.fn>>();
		const pool = createSharedResourcePool({
			create: async (key: string) => {
				const close = vi.fn();
				closes.set(key, close);
				return { close };
			},
			idleTimeoutMs: 60_000,
		});

		await Promise.all([
			pool.use("a", async () => undefined),
			pool.use("b", async () => undefined),
		]);
		await pool.dispose();

		expect(closes.get("a")).toHaveBeenCalledOnce();
		expect(closes.get("b")).toHaveBeenCalledOnce();
		await expect(pool.use("a", async () => undefined)).rejects.toThrow(
			"disposed",
		);
	});
});

test("removes a key without revoking an active lease and never closes its replacement", async () => {
	const closed: number[] = [];
	let next = 0;
	let release!: () => void;
	let started!: () => void;
	const active = new Promise<void>((resolve) => {
		started = resolve;
	});
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const pool = createSharedResourcePool({
		idleTimeoutMs: 30_000,
		create: async () => {
			const id = ++next;
			return {
				id,
				close: () => {
					closed.push(id);
				},
			};
		},
	});
	const first = pool.use("key", async (resource) => {
		started();
		await pending;
		return resource.id;
	});
	await active;
	await pool.remove("key");
	expect(closed).toEqual([]);
	expect(await pool.use("key", async (resource) => resource.id)).toBe(2);
	release();
	expect(await first).toBe(1);
	await pool.dispose();
	expect(closed.sort()).toEqual([1, 2]);
});
