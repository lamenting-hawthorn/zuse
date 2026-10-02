import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Context } from "effect";
import { z } from "zod";
import {
	type ChatGPTVault,
	pendingRegistrationSchema,
	registrationSchema,
} from "./chatgpt-oauth.ts";
import { ModelAuthError } from "./connection-registry.ts";

export interface AccountConnectionTransport {
	readonly accountId: string;
	request(body: Record<string, unknown>): Promise<unknown>;
}
/** Cloud bootstrap installs a transport with its existing rotating runtime credential. */
export class RuntimeModelConnections extends Context.Service<
	RuntimeModelConnections,
	{ current: AccountConnectionTransport | null }
>()("zuse/RuntimeModelConnections") {}

export function accountConnectionVault(
	transport: AccountConnectionTransport,
	provider: "chatgpt" | "supergrok",
	hostId: () => Promise<string>,
): ChatGPTVault {
	const lease = new AsyncLocalStorage<string>();
	const call = async (
		action: string,
		token: string,
		rest: Record<string, unknown> = {},
	) => {
		const result = await transport.request({
			provider,
			action,
			token,
			...rest,
		});
		return z.object({ value: z.unknown() }).parse(result).value;
	};
	const lock = async <T>(
		_id: string,
		operation: () => Promise<T>,
	): Promise<T> => {
		if (lease.getStore()) return operation();
		const token = randomUUID();
		const deadline = Date.now() + 15000;
		while (true) {
			if (z.boolean().parse(await call("acquire", token))) break;
			if (Date.now() >= deadline)
				throw new ModelAuthError("temporarily_unavailable");
			await delay(250);
		}
		try {
			return await lease.run(token, operation);
		} finally {
			await call("release", token).catch(() => {});
		}
	};
	const command = (action: string, rest: Record<string, unknown>) =>
		lock("", () => {
			const token = lease.getStore();
			if (!token) throw new ModelAuthError("storage_failed");
			return call(action, token, rest);
		});
	const read = async (kind: string, id: string) => {
		const value = z
			.string()
			.nullable()
			.parse(await command("read", { kind, id }));
		return value === null ? null : JSON.parse(value);
	};
	return {
		lock,
		hostId,
		read: async (id) => {
			const value = await read("active", id);
			return value === null ? null : registrationSchema.parse(value);
		},
		write: (value) =>
			command("write", {
				kind: "active",
				id: value.id,
				value: JSON.stringify(value),
			}).then(() => undefined),
		list: async () =>
			z
				.array(z.string())
				.parse(await command("list", { kind: "active" }))
				.map((value) => registrationSchema.parse(JSON.parse(value))),
		readPending: async (id) => {
			const value = await read("pending", id);
			return value === null ? null : pendingRegistrationSchema.parse(value);
		},
		writePending: (value) =>
			command("write", {
				kind: "pending",
				id: value.id,
				value: JSON.stringify(value),
			}).then(() => undefined),
		removePending: (id) =>
			command("write", { kind: "pending", id, value: null }).then(
				() => undefined,
			),
		listPending: async () =>
			z
				.array(z.string())
				.parse(await command("list", { kind: "pending" }))
				.map((value) => pendingRegistrationSchema.parse(JSON.parse(value))),
	};
}

export async function connectionStorageRequest(
	url: string,
	headers: Record<string, string>,
	body: Record<string, unknown>,
) {
	const parsed = new URL(url);
	if (
		parsed.protocol !== "https:" &&
		!(
			parsed.protocol === "http:" &&
			["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
		)
	)
		throw new ModelAuthError("unavailable");
	const response = await fetch(url, {
		method: "POST",
		redirect: "error",
		signal: AbortSignal.timeout(10000),
		headers: { ...headers, "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) throw new ModelAuthError("temporarily_unavailable");
	return response.json();
}
