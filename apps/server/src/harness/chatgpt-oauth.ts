import {
	ModelAuthError as ChatGPTAuthError,
	ConnectionRegistry,
} from "./connection-registry.ts";

export { ModelAuthError as ChatGPTAuthError } from "./connection-registry.ts";

import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { ModelConnection } from "@zuse/contracts";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { z } from "zod";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const planUsageScope = "chatgpt.tokens.use.direct";
const scopes = `openid profile email offline_access resource.invoke ${planUsageScope}`;
const tokenSchema = z.object({
	access_token: z.string().min(1).optional(),
	token_type: z.string().optional(),
	refresh_token: z.string().min(1).optional(),
	id_token: z.string().optional(),
	expires_in: z.number().positive().optional(),
	scope: z.string().optional(),
	earliest_refresh_at: z.union([z.number(), z.string()]).optional(),
});
export const registrationSchema = z.object({
	id: z.string(),
	clientId: z.string(),
	subject: z.string(),
	email: z.string().optional(),
	name: z.string(),
	createdAt: z.number(),
	preferred: z.boolean(),
	planNoticeSeen: z.boolean().optional(),
	authorizationGeneration: z.number().int().nonnegative().optional(),
	scope: z.string(),
	idToken: z.string().optional(),
	accessToken: z.string().optional(),
	refreshToken: z.string().optional(),
	expiresAt: z.number().optional(),
	earliestRefreshAt: z.number().optional(),
});
export const pendingRegistrationSchema = z.object({
	id: z.string(),
	clientId: z.string(),
	createdAt: z.number(),
});
export type PendingChatGPTRegistration = z.infer<
	typeof pendingRegistrationSchema
>;
export type ChatGPTRegistration = z.infer<typeof registrationSchema>;
export type ConnectionMetadata = ModelConnection;
export interface ChatGPTVault {
	read(id: string): Promise<ChatGPTRegistration | null>;
	write(value: ChatGPTRegistration): Promise<void>;
	list(): Promise<ChatGPTRegistration[]>;
	hostId(): Promise<string>;
	readPending(id: string): Promise<PendingChatGPTRegistration | null>;
	listPending(): Promise<PendingChatGPTRegistration[]>;
	writePending(value: PendingChatGPTRegistration): Promise<void>;
	removePending(id: string): Promise<void>;
	/** Cross-process lock; reread credentials inside it, including on disconnect. */
	lock<T>(id: string, operation: () => Promise<T>): Promise<T>;
}
const same = (a: string, b: string): boolean => {
	const x = Buffer.from(a),
		y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
};
const metadata = (registration: ChatGPTRegistration): ConnectionMetadata => {
	const authorized =
		!!registration.accessToken &&
		!!registration.refreshToken &&
		registration.scope.split(/\s+/).includes(planUsageScope);
	return {
		id: registration.id,
		clientId: registration.clientId,
		name: registration.name,
		email: registration.email,
		createdAt: registration.createdAt,
		preferred: registration.preferred,
		authorized,
		planNoticeSeen: registration.planNoticeSeen ?? false,
		status: authorized
			? "connected"
			: registration.idToken
				? "permission-required"
				: "disconnected",
	};
};
const refreshTimestamp = (
	value: number | string | undefined,
): number | undefined => {
	if (value === undefined) return undefined;
	const numeric = typeof value === "number" ? value : Number(value);
	const timestamp = Number.isFinite(numeric)
		? numeric < 1e12
			? numeric * 1000
			: numeric
		: Date.parse(String(value));
	if (!Number.isFinite(timestamp))
		throw new ChatGPTAuthError("verification_failed");
	return timestamp;
};
/** Tokens never leave this server-owned service except to its model transport. */
export class ChatGPTOAuth extends ConnectionRegistry {
	private pending = new Map<Server, () => void>();
	private pendingRegistrations = new Map<string, () => void>();
	private keys: ReturnType<typeof createRemoteJWKSet> | undefined;
	private async signingKeys() {
		if (this.keys) return this.keys;
		const response = await this.fetcher(
			`${issuer}/.well-known/openid-configuration`,
			{ signal: AbortSignal.timeout(5000), redirect: "error" },
		);
		if (!response.ok) throw new ChatGPTAuthError("discovery_failed");
		const discovery = z
			.object({ issuer: z.literal(issuer), jwks_uri: z.string().url() })
			.parse(await response.json());
		if (new URL(discovery.jwks_uri).origin !== issuer)
			throw new ChatGPTAuthError("invalid_discovery");
		this.keys = createRemoteJWKSet(new URL(discovery.jwks_uri), {
			[customFetch]: this.fetcher,
		});
		return this.keys;
	}
	constructor(
		vault: ChatGPTVault,
		private readonly fetcher: typeof fetch = fetch,
	) {
		super(vault);
	}

	async list(): Promise<ConnectionMetadata[]> {
		const [active, pending] = await Promise.all([
			this.vault.list(),
			this.vault.listPending(),
		]);
		const ids = new Set(active.map((r) => r.id));
		return [
			...active.map(metadata),
			...pending
				.filter((r) => !ids.has(r.id))
				.map((r) => ({
					id: r.id,
					clientId: r.clientId,
					createdAt: r.createdAt,
					name: "ChatGPT",
					preferred: false,
					authorized: false,
					planNoticeSeen: false,
					status: "pending" as const,
				})),
		].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	}

	async connect(reconnectId?: string): Promise<{
		url: string;
		finished: Promise<ConnectionMetadata>;
		cancel: () => void;
	}> {
		const existing = reconnectId ? await this.vault.read(reconnectId) : null;
		const pending = reconnectId
			? await this.vault.readPending(reconnectId)
			: null;
		if (reconnectId && !existing && !pending)
			throw new ChatGPTAuthError("unknown_registration");
		const host = await this.vault.hostId();
		const registrationId = existing?.id ?? pending?.id ?? randomUUID();
		const savedClientId = existing?.clientId ?? pending?.clientId;
		this.pendingRegistrations.get(registrationId)?.();
		const state = randomBytes(32).toString("base64url"),
			nonce = randomBytes(32).toString("base64url"),
			verifier = randomBytes(32).toString("base64url");
		const challenge = createHash("sha256").update(verifier).digest("base64url");
		let resolve!: (value: ConnectionMetadata) => void,
			reject!: (error: unknown) => void;
		const finished = new Promise<ConnectionMetadata>((yes, no) => {
			resolve = yes;
			reject = no;
		});
		// A caller may attach a waiter after opening the browser.
		void finished.catch(() => {});
		const exchangeAbort = new AbortController();
		let consumed = false;
		let cancelled = false;
		let redirect = "";
		const server = createServer((request, response) => {
			const callback = new URL(request.url ?? "/", redirect);
			if (request.method !== "GET" || callback.pathname !== "/auth/callback") {
				response.writeHead(404).end();
				return;
			}
			const receivedState = callback.searchParams.get("state") ?? "";
			if (
				consumed ||
				callback.searchParams.getAll("state").length !== 1 ||
				!same(state, receivedState)
			) {
				response.writeHead(400).end("Invalid authorization state.");
				return;
			}
			consumed = true;
			if (callback.searchParams.has("error")) {
				response
					.writeHead(400, { "Cache-Control": "no-store" })
					.end("Authorization was not completed. Return to Zuse to retry.");
				cleanup();
				reject(
					new ChatGPTAuthError(
						callback.searchParams.get("error") === "access_denied"
							? "access_denied"
							: "invalid_callback",
					),
				);
				return;
			}
			const code = callback.searchParams.get("code");
			const clientId = callback.searchParams.get("client_id") ?? savedClientId;
			if (
				callback.searchParams.getAll("code").length !== 1 ||
				callback.searchParams.getAll("client_id").length > 1 ||
				callback.searchParams.has("error") ||
				!code ||
				!clientId ||
				clientId === "dynamic_agent_client" ||
				(savedClientId && clientId !== savedClientId)
			) {
				response.writeHead(400).end("Authorization was not completed.");
				cleanup();
				reject(new ChatGPTAuthError("invalid_callback"));
				return;
			}
			void (async () => {
				if (!existing)
					await this.vault.lock(registrationId, async () => {
						if (cancelled) throw new ChatGPTAuthError("cancelled");
						await this.vault.writePending({
							id: registrationId,
							clientId,
							createdAt: pending?.createdAt ?? Date.now(),
						});
					});
				return this.exchange(
					new URLSearchParams({
						grant_type: "authorization_code",
						client_id: clientId,
						code,
						code_verifier: verifier,
						redirect_uri: redirect,
						resource,
					}),
					exchangeAbort.signal,
				);
			})()
				.then(async (tokens) => {
					if (!tokens.id_token || tokens.scope === undefined)
						throw new ChatGPTAuthError("missing_tokens");
					const identity = await jwtVerify(
						tokens.id_token,
						await this.signingKeys(),
						{
							issuer,
							audience: clientId,
							requiredClaims: ["exp", "iat", "sub", "nonce"],
						},
					);
					if (
						typeof identity.payload.nonce !== "string" ||
						!same(identity.payload.nonce, nonce) ||
						!identity.payload.sub ||
						(existing && existing.subject !== identity.payload.sub)
					)
						throw new ChatGPTAuthError("identity_mismatch");
					const registration: ChatGPTRegistration = {
						id: registrationId,
						clientId,
						subject: identity.payload.sub,
						...(typeof identity.payload.email === "string"
							? { email: identity.payload.email }
							: {}),
						name:
							existing?.name ??
							(typeof identity.payload.email === "string"
								? identity.payload.email
								: "ChatGPT"),
						createdAt: existing?.createdAt ?? pending?.createdAt ?? Date.now(),
						preferred: existing?.preferred ?? false,
						planNoticeSeen: existing?.planNoticeSeen,
						scope: tokens.scope ?? "",
						idToken: tokens.id_token,
						accessToken: tokens.access_token,
						refreshToken: tokens.refresh_token,
						expiresAt:
							tokens.expires_in === undefined
								? undefined
								: Date.now() + tokens.expires_in * 1000,
						earliestRefreshAt: refreshTimestamp(tokens.earliest_refresh_at),
					};
					await this.vault.lock(registration.id, async () => {
						if (cancelled) throw new ChatGPTAuthError("cancelled");
						const current = await this.vault.read(registration.id);
						if (
							existing &&
							(current?.authorizationGeneration ?? 0) !==
								(existing.authorizationGeneration ?? 0)
						)
							throw new ChatGPTAuthError("cancelled");
						registration.name = current?.name ?? registration.name;
						registration.preferred =
							current?.preferred ?? registration.preferred;
						registration.planNoticeSeen =
							current?.planNoticeSeen ?? registration.planNoticeSeen;
						registration.authorizationGeneration =
							(current?.authorizationGeneration ?? 0) + 1;
						await this.vault.write(registration);
						await this.vault.removePending(registration.id);
					});
					response
						.writeHead(200, {
							"Content-Type": "text/plain; charset=utf-8",
							"Cache-Control": "no-store",
						})
						.end("Connected to Zuse. You can close this window.");
					cleanup();
					resolve(metadata(registration));
				})
				.catch((error) => {
					response
						.writeHead(400)
						.end("Sign-in failed. Please return to Zuse and retry.");
					cleanup();
					reject(
						error instanceof ChatGPTAuthError
							? error
							: new ChatGPTAuthError("verification_failed"),
					);
				});
		});
		const cleanup = () => {
			clearTimeout(timeout);
			this.pending.delete(server);
			if (this.pendingRegistrations.get(registrationId) === cancel)
				this.pendingRegistrations.delete(registrationId);
			server.close();
		};
		const cancel = (code = "cancelled") => {
			cancelled = true;
			exchangeAbort.abort();
			cleanup();
			server.closeAllConnections();
			reject(new ChatGPTAuthError(code));
		};
		const timeout = setTimeout(() => cancel("timeout"), 5 * 60_000);
		timeout.unref();
		this.pending.set(server, cancel);
		this.pendingRegistrations.set(registrationId, cancel);
		await new Promise<void>((yes, no) => {
			server.once("error", no);
			server.listen(0, "127.0.0.1", yes);
		}).catch((error) => {
			cleanup();
			throw error;
		});
		const address = server.address();
		if (!address || typeof address === "string")
			throw new ChatGPTAuthError("loopback_unavailable");
		redirect = `http://127.0.0.1:${address.port}/auth/callback`;
		const url = new URL(`${issuer}/api/accounts/authorize`);
		url.search = new URLSearchParams({
			client_id: savedClientId ?? "dynamic_agent_client",
			...(!savedClientId
				? { agent_name_hint: "Zuse" }
				: existing?.email
					? { login_hint: existing.email }
					: {}),
			ext_agent_host_id: host,
			response_type: "code",
			redirect_uri: redirect,
			scope: scopes,
			resource,
			...(existing && !existing.scope.split(/\s+/).includes(planUsageScope)
				? { prompt: "consent" }
				: {}),
			state,
			nonce,
			code_challenge: challenge,
			code_challenge_method: "S256",
		}).toString();
		return { url: url.href, finished, cancel };
	}
	private async exchange(body: URLSearchParams, signal?: AbortSignal) {
		const response = await this.fetcher(`${issuer}/api/accounts/oauth/token`, {
			method: "POST",
			redirect: "error",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
				: AbortSignal.timeout(30_000),
		});
		if (!response.ok)
			throw new ChatGPTAuthError(
				response.status === 400 || response.status === 401
					? "reauthorization_required"
					: "temporarily_unavailable",
			);
		const tokens = tokenSchema.parse(await response.json());
		const granted = tokens.scope?.split(/\s+/) ?? [];
		if (
			tokens.access_token &&
			(tokens.token_type?.toLowerCase() !== "bearer" ||
				tokens.expires_in === undefined)
		)
			throw new ChatGPTAuthError("verification_failed");
		if (
			(body.get("grant_type") === "refresh_token" ||
				granted.includes("offline_access") ||
				granted.includes(planUsageScope)) &&
			(!tokens.access_token || !tokens.refresh_token)
		)
			throw new ChatGPTAuthError("verification_failed");
		return tokens;
	}
	async credential(
		id: string,
	): Promise<{ connectionId: string; accessToken: string }> {
		return this.vault.lock(id, async () => {
			const value = await this.vault.read(id);
			if (
				!value?.accessToken ||
				!value.refreshToken ||
				!value.scope.split(/\s+/).includes(planUsageScope)
			)
				throw new ChatGPTAuthError("reauthorization_required");
			const now = Date.now();
			if ((value.earliestRefreshAt ?? 0) > now && (value.expiresAt ?? 0) <= now)
				throw new ChatGPTAuthError("refresh_not_yet_available");
			if (
				(value.expiresAt ?? 0) > now + 60_000 ||
				(value.earliestRefreshAt ?? 0) > now
			)
				return { connectionId: id, accessToken: value.accessToken };
			const tokens = await this.exchange(
				new URLSearchParams({
					grant_type: "refresh_token",
					client_id: value.clientId,
					refresh_token: value.refreshToken,
					resource,
				}),
			);
			if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in)
				throw new ChatGPTAuthError("reauthorization_required");
			const refreshed = {
				...value,
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token ?? value.refreshToken,
				expiresAt:
					tokens.expires_in === undefined
						? undefined
						: Date.now() + tokens.expires_in * 1000,
				earliestRefreshAt: refreshTimestamp(tokens.earliest_refresh_at),
				scope: tokens.scope ?? value.scope,
			};
			await this.vault.write(refreshed);
			return { connectionId: id, accessToken: refreshed.accessToken };
		});
	}
	async disconnect(id: string): Promise<{ revoked: boolean }> {
		this.pendingRegistrations.get(id)?.();
		return this.vault.lock(id, async () => {
			const value = await this.vault.read(id);
			if (!value) return { revoked: true };
			const {
				idToken: _idToken,
				accessToken: _access,
				refreshToken,
				expiresAt: _expires,
				earliestRefreshAt: _earliest,
				...registration
			} = value;
			// Local removal is authoritative, even if remote revocation is unavailable.
			await this.vault.write({
				...registration,
				authorizationGeneration: (value.authorizationGeneration ?? 0) + 1,
			});
			if (refreshToken)
				try {
					const discovery = await this.fetcher(
						`${issuer}/.well-known/openid-configuration`,
						{ signal: AbortSignal.timeout(5000), redirect: "error" },
					);
					const config = z
						.object({ revocation_endpoint: z.string().url().optional() })
						.parse(await discovery.json());
					if (
						config.revocation_endpoint &&
						new URL(config.revocation_endpoint).origin === issuer
					) {
						for (let attempt = 0; attempt < 2; attempt++) {
							try {
								const response = await this.fetcher(
									config.revocation_endpoint,
									{
										method: "POST",
										redirect: "error",
										headers: {
											"Content-Type": "application/x-www-form-urlencoded",
										},
										body: new URLSearchParams({
											token: refreshToken,
											token_type_hint: "refresh_token",
											client_id: value.clientId,
										}),
										signal: AbortSignal.timeout(5000),
									},
								);
								if (response.status === 200) return { revoked: true };
								if (response.status < 500) return { revoked: false };
							} catch {
								/* Retry one transient network failure while the old token is in memory. */
							}
							if (attempt === 0) await delay(200);
						}
					}
				} catch {
					/* Disconnected locally. */
				}
			return { revoked: !refreshToken };
		});
	}
	close(): void {
		for (const cancel of this.pending.values()) cancel();
		this.pending.clear();
	}
}
