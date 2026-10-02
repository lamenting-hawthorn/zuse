import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { digest } from "@zuse/agents/harness/cache";
import type { ModelConnectionProvider } from "@zuse/contracts";
import { Effect } from "effect";
import { withProcessLock } from "../process/process-lock.ts";
import type { CredentialsServiceShape } from "../provider/services/credentials-service.ts";
import {
	type ModelVault,
	pendingRegistrationSchema,
	registrationSchema,
} from "./connection-types.ts";

/** Same encrypted vault as existing integrations; Codex auth files are never read. */
export function modelConnectionVault(
	credentials: CredentialsServiceShape,
	userData: string,
	provider: ModelConnectionProvider = "chatgpt",
): ModelVault {
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
		return withProcessLock(
			join(userData, "harness-locks", `${digest(`${provider}:${id}`)}.sqlite`),
			operation,
		);
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
