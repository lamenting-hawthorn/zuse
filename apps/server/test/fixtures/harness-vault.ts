import type {
	ChatGPTRegistration,
	ChatGPTVault,
	PendingChatGPTRegistration,
} from "../../src/harness/chatgpt-oauth.ts";
export function vault() {
	const registrations = new Map<string, ChatGPTRegistration>();
	const pending = new Map<string, PendingChatGPTRegistration>();
	const locks = new Map<string, Promise<unknown>>();
	const storage: ChatGPTVault = {
		readPending: async (id) => pending.get(id) ?? null,
		listPending: async () => [...pending.values()],
		writePending: async (value) => {
			pending.set(value.id, value);
		},
		removePending: async (id) => {
			pending.delete(id);
		},
		read: async (id) => registrations.get(id) ?? null,
		write: async (value) => {
			registrations.set(value.id, value);
		},
		list: async () => [...registrations.values()],
		hostId: async () => "urn:uuid:test-host",
		lock: async (id, operation) => {
			const pending = (locks.get(id) ?? Promise.resolve())
				.catch(() => {})
				.then(operation);
			locks.set(id, pending);
			try {
				return await pending;
			} finally {
				if (locks.get(id) === pending) locks.delete(id);
			}
		},
	};
	return { storage, registrations };
}
