import type { ChatGPTVault } from "./chatgpt-oauth.ts";
export class ModelAuthError extends Error {
	constructor(readonly code: string) {
		super(`Model sign-in failed (${code}).`);
	}
}
export class ConnectionRegistry {
	constructor(protected readonly vault: ChatGPTVault) {}
	async acknowledgePlan(id: string): Promise<void> {
		await this.vault.lock(id, async () => {
			const value = await this.vault.read(id);
			if (!value) throw new ModelAuthError("unknown_registration");
			await this.vault.write({ ...value, planNoticeSeen: true });
		});
	}

	async rename(id: string, name: string): Promise<void> {
		if (!name.trim() || name.length > 200)
			throw new ModelAuthError("invalid_name");
		await this.vault.lock(id, async () => {
			const value = await this.vault.read(id);
			if (!value) throw new ModelAuthError("unknown_registration");
			await this.vault.write({ ...value, name: name.trim() });
		});
	}
	async preferred(id: string): Promise<void> {
		await this.vault.lock("preferred", async () => {
			const connections = await this.vault.list();
			if (!connections.some((value) => value.id === id))
				throw new ModelAuthError("unknown_registration");
			for (const registration of connections)
				await this.vault.lock(registration.id, async () => {
					const current = await this.vault.read(registration.id);
					if (current)
						await this.vault.write({
							...current,
							preferred: current.id === id,
						});
				});
		});
	}
}
