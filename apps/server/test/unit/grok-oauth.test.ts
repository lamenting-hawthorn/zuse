import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, it } from "vitest";
import { GrokOAuth } from "../../src/harness/grok-oauth.ts";
import { vault } from "../fixtures/harness-vault.ts";

async function fixture(
	options: {
		verificationUrl?: string;
		errors?: string[];
		subject?: string;
	} = {},
) {
	const store = vault();
	const pair = await generateKeyPair("ES256");
	const jwk = await exportJWK(pair.publicKey);
	const idToken = await new SignJWT({
		email: "same@example.com",
		email_verified: true,
	})
		.setSubject(options.subject ?? "user")
		.setIssuer("https://auth.x.ai")
		.setAudience("zuse-test-client")
		.setIssuedAt()
		.setExpirationTime("1h")
		.setProtectedHeader({ alg: "ES256", kid: "test" })
		.sign(pair.privateKey);
	const polls: number[] = [];
	const errors = [...(options.errors ?? [])];
	let refreshes = 0;
	const fetcher: typeof fetch = async (url, init) => {
		if (String(url).endsWith("jwks.json"))
			return Response.json({ keys: [{ ...jwk, kid: "test" }] });
		expect(init?.redirect).toBe("error");
		if (String(url).endsWith("device/code"))
			return Response.json({
				device_code: "private-code",
				user_code: "ABCD-1234",
				verification_uri:
					options.verificationUrl ?? "https://accounts.x.ai/device",
				expires_in: 600,
				interval: 1,
			});
		if (String(url).endsWith("revoke"))
			return new Response(null, { status: 503 });
		const params = new URLSearchParams(String(init?.body));
		if (params.get("grant_type") === "refresh_token") {
			refreshes++;
			return Response.json({
				access_token: "new-access",
				refresh_token: "new-refresh",
				token_type: "Bearer",
				expires_in: 3600,
			});
		}
		polls.push(Date.now());
		const error = errors.shift();
		if (error) return Response.json({ error }, { status: 400 });
		return Response.json({
			access_token: "access-secret",
			refresh_token: "refresh-secret",
			id_token: idToken,
			token_type: "Bearer",
			expires_in: 3600,
			scope: "api:access offline_access",
		});
	};
	return {
		...store,
		auth: new GrokOAuth(store.storage, "zuse-test-client", fetcher),
		polls,
		refreshes: () => refreshes,
	};
}
it("verifies device identity, exposes only code/metadata, rotates once, and disconnects durably", async () => {
	const f = await fixture();
	const flow = await f.auth.connect();
	expect(JSON.stringify(flow.event)).not.toContain("private-code");
	const account = await flow.finished;
	expect(account).toMatchObject({
		provider: "supergrok",
		email: "same@example.com",
		authorized: true,
	});
	expect(JSON.stringify(await f.auth.list())).not.toMatch(
		/access-secret|refresh-secret/,
	);
	const record = f.registrations.get(account.id);
	if (!record) throw new Error("Missing registration");
	f.registrations.set(account.id, { ...record, expiresAt: 0 });
	const results = await Promise.all([
		f.auth.credential(account.id),
		f.auth.credential(account.id),
	]);
	expect(results[0]?.accessToken).toBe("new-access");
	expect(f.refreshes()).toBe(1);
	expect(f.registrations.get(account.id)?.refreshToken).toBe("new-refresh");
	expect(await f.auth.disconnect(account.id)).toEqual({ revoked: false });
	await expect(f.auth.credential(account.id)).rejects.toThrow(
		"reauthorization_required",
	);
	expect(JSON.stringify(f.registrations.get(account.id))).not.toMatch(
		/new-refresh|new-access/,
	);
});
it("honors authorization_pending and slow_down without prematurely polling", async () => {
	const f = await fixture({ errors: ["authorization_pending", "slow_down"] });
	const start = Date.now();
	const flow = await f.auth.connect();
	await flow.finished;
	expect(f.polls).toHaveLength(3);
	expect((f.polls[0] ?? 0) - start).toBeGreaterThanOrEqual(990);
	expect((f.polls[1] ?? 0) - (f.polls[0] ?? 0)).toBeGreaterThanOrEqual(990);
	expect((f.polls[2] ?? 0) - (f.polls[1] ?? 0)).toBeGreaterThanOrEqual(5990);
}, 15000);
it("rejects foreign verification URLs and cancels polling without saving tokens", async () => {
	const unsafe = await fixture({ verificationUrl: "https://evil.test/device" });
	await expect(unsafe.auth.connect()).rejects.toThrow("verification_failed");
	const safe = await fixture();
	const flow = await safe.auth.connect();
	flow.cancel();
	await expect(flow.finished).rejects.toThrow();
	expect(safe.registrations.size).toBe(0);
});
it("returns a safe denial and does not store a partial authorization", async () => {
	const f = await fixture({ errors: ["access_denied"] });
	const flow = await f.auth.connect();
	await expect(flow.finished).rejects.toThrow("access_denied");
	expect(f.registrations.size).toBe(0);
});
it("a second runtime's disconnect prevents an older device login from restoring access", async () => {
	const f = await fixture();
	const first = await (await f.auth.connect()).finished;
	const reconnect = await f.auth.connect(first.id);
	const record = f.registrations.get(first.id);
	if (!record) throw new Error("Missing registration");
	f.registrations.set(first.id, {
		...record,
		authorizationGeneration: 2,
		accessToken: undefined,
		refreshToken: undefined,
	});
	await expect(reconnect.finished).rejects.toThrow("cancelled");
	expect(f.registrations.get(first.id)?.accessToken).toBeUndefined();
});
