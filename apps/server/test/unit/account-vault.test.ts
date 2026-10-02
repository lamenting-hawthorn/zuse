import { Effect } from "effect";
import { expect, it } from "vitest";
import { combineModelConnections } from "../../src/harness/account-connections-service.ts";
import { accountConnectionVault } from "../../src/harness/account-vault.ts";
import { ChatGPTOAuth } from "../../src/harness/chatgpt-oauth.ts";
import { makeModelConnections } from "../../src/harness/connections-service.ts";
import { vault } from "../fixtures/harness-vault.ts";

it("shares durable registrations between hosts and reuses a nested distributed lease", async () => {
	const data = new Map<string, string>();
	let token: string | null = null;
	let leases = 0;
	const request = async (body: Record<string, unknown>) => {
		const key = `${body.kind}:${body.id}`;
		if (body.action === "acquire") {
			if (token) return { value: false };
			token = String(body.token);
			leases++;
			return { value: true };
		}
		expect(body.token).toBe(token);
		if (body.action === "release") {
			token = null;
			return { value: null };
		}
		if (body.action === "write") {
			if (body.value === null) data.delete(key);
			else data.set(key, String(body.value));
			return { value: null };
		}
		if (body.action === "read") return { value: data.get(key) ?? null };
		return {
			value: [...data.keys()]
				.filter((key) => key.startsWith(`${body.kind}:`))
				.map((key) => data.get(key)),
		};
	};
	const one = accountConnectionVault(
		{ accountId: "a", request },
		"supergrok",
		async () => "host-one",
	);
	const two = accountConnectionVault(
		{ accountId: "a", request },
		"supergrok",
		async () => "host-two",
	);
	await one.lock("refresh", async () => {
		await one.write({
			id: "grok",
			clientId: "client",
			subject: "subject",
			name: "SuperGrok",
			createdAt: 1,
			preferred: false,
			scope: "api:access",
			accessToken: "secret",
			refreshToken: "rotating",
		});
		expect((await one.read("grok"))?.accessToken).toBe("secret");
	});
	expect(leases).toBe(1);
	expect(token).toBeNull();
	expect((await two.list())[0]?.refreshToken).toBe("rotating");
	expect(await two.hostId()).toBe("host-two");
	await expect(
		one.lock("failed", async () => {
			throw new Error("failed");
		}),
	).rejects.toThrow("failed");
	expect(token).toBeNull();
});
it("never resolves an account connection under a different signed-in account", async () => {
	const auth = new ChatGPTOAuth(vault().storage);
	const service = makeModelConnections(auth, true);
	const combined = combineModelConnections(service, () =>
		Effect.succeed({ accountId: "other", service }),
	);
	await expect(
		Effect.runPromise(combined.credential("account:original:connection")),
	).rejects.toMatchObject({ code: "unknown_registration" });
	auth.close();
});
