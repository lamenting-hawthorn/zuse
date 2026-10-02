import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { ChatGPTOAuth } from "../../src/harness/chatgpt-oauth.ts";

import { vault } from "../fixtures/harness-vault.ts";

describe("ChatGPT public client authorization", () => {
	it("keeps pending authorization separate and rejects invalid state without consuming the valid callback", async () => {
		const store = vault();
		let exchanges = 0;
		const auth = new ChatGPTOAuth(store.storage, async () => {
			exchanges++;
			throw new Error("must not exchange");
		});
		const flow = await auth.connect();
		const url = new URL(flow.url);
		const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
		callback.search = new URLSearchParams({
			state: "invalid",
			code: "code",
			client_id: "issued",
		}).toString();
		const invalid = await fetch(callback);
		expect(invalid.status).toBe(400);
		expect(exchanges).toBe(0);
		expect(await auth.list()).toEqual([]);
		expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("scope")?.split(" ")).toContain(
			"chatgpt.tokens.use.direct",
		);
		expect(url.searchParams.get("ext_agent_host_id")).toBe(
			"urn:uuid:test-host",
		);
		flow.cancel();
		await expect(flow.finished).rejects.toThrow("cancelled");
		auth.close();
	});
	it("validates issued client and nonce, preserves distinct same-email registrations, and returns metadata only", async () => {
		const store = vault();
		const keys = await generateKeyPair("RS256");
		const jwk = await exportJWK(keys.publicKey);
		let nonce = "";
		let issued = "client-one";
		const auth = new ChatGPTOAuth(store.storage, async (url, init) => {
			const path = String(url);
			if (path.endsWith("openid-configuration"))
				return Response.json({
					issuer: "https://auth.openai.com",
					jwks_uri: "https://auth.openai.com/keys",
				});
			if (path.endsWith("/keys"))
				return Response.json({
					keys: [{ ...jwk, kid: "key", alg: "RS256", use: "sig" }],
				});
			const body = new URLSearchParams(String(init?.body));
			expect(body.get("client_id")).toBe(issued);
			expect(body.get("client_secret")).toBeNull();
			expect(body.get("code_verifier")).toBeTruthy();
			const token = await new SignJWT({ nonce, email: "same@example.com" })
				.setProtectedHeader({ alg: "RS256", kid: "key" })
				.setIssuer("https://auth.openai.com")
				.setAudience(issued)
				.setSubject("subject")
				.setIssuedAt()
				.setExpirationTime("5m")
				.sign(keys.privateKey);
			return Response.json({
				token_type: "Bearer",
				access_token: "private-access",
				refresh_token: "private-refresh",
				id_token: token,
				scope: "chatgpt.tokens.use.direct",
				expires_in: 3600,
			});
		});
		try {
			for (const client of ["client-one", "client-two"]) {
				issued = client;
				const flow = await auth.connect();
				const authorization = new URL(flow.url);
				nonce = authorization.searchParams.get("nonce") ?? "";
				const callback = new URL(
					authorization.searchParams.get("redirect_uri") ?? "",
				);
				callback.search = new URLSearchParams({
					state: authorization.searchParams.get("state") ?? "",
					code: "code",
					client_id: issued,
				}).toString();
				expect((await fetch(callback)).status).toBe(200);
				await flow.finished;
			}
			const connections = await auth.list();
			expect(connections).toHaveLength(2);
			expect(
				connections.every((c) => c.authorized && c.status === "connected"),
			).toBe(true);
			for (const connection of connections) {
				expect((await auth.credential(connection.id)).accessToken).toBe(
					"private-access",
				);
			}
			expect(connections[0]?.id).not.toBe(connections[1]?.id);
			expect(JSON.stringify(connections)).not.toContain("private-");
		} finally {
			auth.close();
		}
	});
	it("serializes rotating refreshes and retains registration after disconnect", async () => {
		const store = vault();
		store.registrations.set("one", {
			id: "one",
			clientId: "issued",
			subject: "subject",
			name: "account",
			createdAt: 1,
			preferred: true,
			scope: "chatgpt.tokens.use.direct",
			accessToken: "expired",
			refreshToken: "refresh-old",
			expiresAt: 0,
		});
		let refreshes = 0;
		const auth = new ChatGPTOAuth(store.storage, async (url, init) => {
			if (String(url).endsWith("openid-configuration"))
				return Response.json({});
			refreshes++;
			const body = new URLSearchParams(String(init?.body));
			expect(body.get("refresh_token")).toBe("refresh-old");
			return Response.json({
				token_type: "Bearer",
				access_token: "new",
				refresh_token: "rotated",
				scope: "chatgpt.tokens.use.direct",
				expires_in: 3600,
			});
		});
		const credentials = await Promise.all([
			auth.credential("one"),
			auth.credential("one"),
		]);
		expect(refreshes).toBe(1);
		expect(credentials[0]?.accessToken).toBe("new");
		expect(store.registrations.get("one")?.refreshToken).toBe("rotated");
		await auth.disconnect("one");
		expect(store.registrations.get("one")?.clientId).toBe("issued");
		expect((await auth.list())[0]?.authorized).toBe(false);
		await expect(auth.credential("one")).rejects.toThrow(
			"reauthorization_required",
		);
	});
});

it("retains a newly issued registration separately when code exchange fails", async () => {
	const store = vault();
	const auth = new ChatGPTOAuth(store.storage, async () =>
		Response.json({ error: "invalid_grant" }, { status: 400 }),
	);
	const flow = await auth.connect();
	const authorization = new URL(flow.url);
	const callback = new URL(
		authorization.searchParams.get("redirect_uri") ?? "",
	);
	callback.search = new URLSearchParams({
		state: authorization.searchParams.get("state") ?? "",
		code: "expired",
		client_id: "issued-retained",
	}).toString();
	await fetch(callback);
	await expect(flow.finished).rejects.toThrow("reauthorization_required");
	expect(store.registrations.size).toBe(0);
	const pending = (await auth.list())[0];
	expect(pending).toMatchObject({
		clientId: "issued-retained",
		status: "pending",
		authorized: false,
	});
	if (!pending) throw new Error("Missing pending registration");
	auth.close();
	const restarted = new ChatGPTOAuth(store.storage);
	const retry = await restarted.connect(pending.id);
	expect(new URL(retry.url).searchParams.get("client_id")).toBe(
		"issued-retained",
	);
	expect(new URL(retry.url).searchParams.has("agent_name_hint")).toBe(false);
	retry.cancel();
	restarted.close();
});
it("preserves a verified identity-only sign-in and requests consent on reconnect", async () => {
	const store = vault();
	const keys = await generateKeyPair("RS256");
	const jwk = await exportJWK(keys.publicKey);
	let nonce = "";
	const auth = new ChatGPTOAuth(store.storage, async (url) => {
		if (String(url).endsWith("openid-configuration"))
			return Response.json({
				issuer: "https://auth.openai.com",
				jwks_uri: "https://auth.openai.com/keys",
			});
		if (String(url).endsWith("/keys"))
			return Response.json({
				keys: [{ ...jwk, kid: "key", alg: "RS256", use: "sig" }],
			});
		return Response.json({
			scope: "openid email profile",
			id_token: await new SignJWT({ nonce, email: "identity@example.com" })
				.setProtectedHeader({ alg: "RS256", kid: "key" })
				.setIssuer("https://auth.openai.com")
				.setAudience("identity-client")
				.setSubject("subject")
				.setIssuedAt()
				.setExpirationTime("5m")
				.sign(keys.privateKey),
		});
	});
	try {
		const flow = await auth.connect();
		const authorization = new URL(flow.url);
		nonce = authorization.searchParams.get("nonce") ?? "";
		const callback = new URL(
			authorization.searchParams.get("redirect_uri") ?? "",
		);
		callback.search = new URLSearchParams({
			state: authorization.searchParams.get("state") ?? "",
			code: "valid",
			client_id: "identity-client",
		}).toString();
		expect((await fetch(callback)).status).toBe(200);
		const connection = await flow.finished;
		expect(connection).toMatchObject({
			status: "permission-required",
			authorized: false,
		});
		expect(JSON.stringify(connection)).not.toContain("idToken");
		await expect(auth.credential(connection.id)).rejects.toThrow(
			"reauthorization_required",
		);
		const reconnect = await auth.connect(connection.id);
		expect(new URL(reconnect.url).searchParams.get("prompt")).toBe("consent");
		reconnect.cancel();
	} finally {
		auth.close();
	}
});
it("normalizes provider refresh timestamps and persists the welcome acknowledgement", async () => {
	const store = vault();
	store.registrations.set("one", {
		id: "one",
		clientId: "issued",
		subject: "subject",
		name: "test",
		createdAt: 1,
		preferred: false,
		scope: "chatgpt.tokens.use.direct",
		accessToken: "old",
		refreshToken: "refresh",
		expiresAt: 0,
	});
	const earliest = Math.floor(Date.now() / 1000) + 120;
	const auth = new ChatGPTOAuth(store.storage, async () =>
		Response.json({
			token_type: "Bearer",
			access_token: "new",
			refresh_token: "new-refresh",
			scope: "chatgpt.tokens.use.direct",
			expires_in: 3600,
			earliest_refresh_at: String(earliest),
		}),
	);
	await auth.credential("one");
	expect(store.registrations.get("one")?.earliestRefreshAt).toBe(
		earliest * 1000,
	);
	await auth.acknowledgePlan("one");
	expect((await auth.list())[0]?.planNoticeSeen).toBe(true);
	await auth.rename("one", " Renamed ");
	await auth.preferred("one");
	expect((await auth.list())[0]).toMatchObject({
		name: "Renamed",
		preferred: true,
		planNoticeSeen: true,
	});
	auth.close();
});

it("a disconnect in another runtime prevents an older reconnect from restoring credentials", async () => {
	const store = vault();
	store.registrations.set("one", {
		id: "one",
		clientId: "issued",
		subject: "subject",
		name: "original",
		createdAt: 1,
		preferred: false,
		scope: "chatgpt.tokens.use.direct",
		accessToken: "old",
		refreshToken: "refresh",
		idToken: "saved-identity",
		authorizationGeneration: 1,
	});
	const keys = await generateKeyPair("RS256");
	const jwk = await exportJWK(keys.publicKey);
	let nonce = "";
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let exchanging = false;
	const auth = new ChatGPTOAuth(store.storage, async (url) => {
		if (String(url).endsWith("openid-configuration"))
			return Response.json({
				issuer: "https://auth.openai.com",
				jwks_uri: "https://auth.openai.com/keys",
			});
		if (String(url).endsWith("/keys"))
			return Response.json({
				keys: [{ ...jwk, kid: "key", alg: "RS256", use: "sig" }],
			});
		exchanging = true;
		await gate;
		return Response.json({
			token_type: "Bearer",
			access_token: "new",
			refresh_token: "new-refresh",
			expires_in: 3600,
			scope: "chatgpt.tokens.use.direct",
			id_token: await new SignJWT({ nonce })
				.setProtectedHeader({ alg: "RS256", kid: "key" })
				.setIssuer("https://auth.openai.com")
				.setAudience("issued")
				.setSubject("subject")
				.setIssuedAt()
				.setExpirationTime("5m")
				.sign(keys.privateKey),
		});
	});
	const other = new ChatGPTOAuth(store.storage, async () => Response.json({}));
	try {
		const flow = await auth.connect("one");
		const authorization = new URL(flow.url);
		nonce = authorization.searchParams.get("nonce") ?? "";
		const callback = new URL(
			authorization.searchParams.get("redirect_uri") ?? "",
		);
		callback.search = new URLSearchParams({
			state: authorization.searchParams.get("state") ?? "",
			code: "valid",
		}).toString();
		const response = fetch(callback);
		await expect.poll(() => exchanging).toBe(true);
		await other.disconnect("one");
		release();
		await response;
		await expect(flow.finished).rejects.toThrow("cancelled");
		expect((await auth.list())[0]).toMatchObject({
			authorized: false,
			status: "disconnected",
		});
		expect(store.registrations.get("one")?.accessToken).toBeUndefined();
	} finally {
		release();
		auth.close();
		other.close();
	}
});

it("retries transient revocation and clears tokens before any new credential request", async () => {
	const store = vault();
	store.registrations.set("one", {
		id: "one",
		clientId: "issued",
		subject: "subject",
		name: "test",
		createdAt: 1,
		preferred: true,
		scope: "chatgpt.tokens.use.direct",
		accessToken: "private",
		refreshToken: "renewable",
	});
	let revocations = 0;
	const auth = new ChatGPTOAuth(store.storage, async (url, init) => {
		if (String(url).endsWith("openid-configuration"))
			return Response.json({
				revocation_endpoint: "https://auth.openai.com/revoke",
			});
		expect(store.registrations.get("one")?.accessToken).toBeUndefined();
		expect(init?.redirect).toBe("error");
		return ++revocations === 1
			? new Response(null, { status: 503 })
			: new Response(null, { status: 200 });
	});
	expect(await auth.disconnect("one")).toEqual({ revoked: true });
	expect(revocations).toBe(2);
	await expect(auth.credential("one")).rejects.toThrow(
		"reauthorization_required",
	);
	auth.close();
});
