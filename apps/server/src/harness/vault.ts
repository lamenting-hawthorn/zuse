import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { digest } from "@zuse/agents/harness/cache";
import { Effect } from "effect";
import { acquireProcessLock } from "../cache/process-lock.ts";
import type { CredentialsServiceShape } from "../provider/services/credentials-service.ts";
import {
	type ChatGPTVault,
	pendingRegistrationSchema,
	registrationSchema,
} from "./chatgpt-oauth.ts";

/** Same encrypted vault as existing integrations; Codex auth files are never read. */
export function chatGPTVault(
	credentials: CredentialsServiceShape,
	userData: string,
	provider: "chatgpt" | "supergrok" = "chatgpt",
): ChatGPTVault {
	const namespace = `zuse-${provider}-connections`;
	const pendingNamespace = `zuse-${provider}-pending-registrations`;
	const readPending = async (id: string) => {
		const raw = await Effect.runPromise(
			credentials.getIntegration(pendingNamespace, id),
		);
		return raw === null
			? null
			: pendingRegistrationSchema.parse(JSON.parse(raw));
	};
	const read = async (id: string) => {
		const raw = await Effect.runPromise(
			credentials.getIntegration(namespace, id),
		);
		return raw === null ? null : registrationSchema.parse(JSON.parse(raw));
	};
	const lock = async <T>(
		id: string,
		operation: () => Promise<T>,
	): Promise<T> => {
		const directory = join(userData, "harness-locks");
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const database = await Effect.runPromise(
			acquireProcessLock(
				join(directory, `${digest(`${provider}:${id}`)}.sqlite`),
			),
		);
		try {
			return await operation();
		} finally {
			database.close();
		}
	};
	return {
		readPending,
		listPending: async () => {
			const ids = await Effect.runPromise(
				credentials.listIntegrationAccounts(pendingNamespace),
			);
			return (await Promise.all(ids.map(readPending))).filter(
				(r) => r !== null,
			);
		},
		writePending: (value) =>
			Effect.runPromise(
				credentials.setIntegration(
					pendingNamespace,
					value.id,
					JSON.stringify(value),
				),
			),
		removePending: (id) =>
			Effect.runPromise(credentials.removeIntegration(pendingNamespace, id)),
		read,
		write: (value) =>
			Effect.runPromise(
				credentials.setIntegration(namespace, value.id, JSON.stringify(value)),
			),
		list: async () => {
			const ids = await Effect.runPromise(
				credentials.listIntegrationAccounts(namespace),
			);
			const rows = await Promise.all(ids.map(read));
			return rows.filter((value) => value !== null);
		},
		lock,
		hostId: () =>
			lock("host-identity", async () => {
				const id = await Effect.runPromise(
					credentials.getIntegration("zuse-harness", "host-id"),
				);
				if (id) return id;
				const created = `urn:uuid:${randomUUID()}`;
				await Effect.runPromise(
					credentials.setIntegration("zuse-harness", "host-id", created),
				);
				return created;
			}),
	};
}
