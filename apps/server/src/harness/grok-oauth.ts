import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ModelConnection, ModelSignInEvent } from "@zuse/contracts";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { z } from "zod";
import type { ChatGPTRegistration, ChatGPTVault } from "./chatgpt-oauth.ts";
import { ConnectionRegistry, ModelAuthError } from "./connection-registry.ts";

// Protocol checked against https://auth.x.ai/.well-known/openid-configuration
// and NousResearch/hermes-agent's auth_xai.py/auth_constants.py.
// This is xAI's public Grok CLI client, not a Zuse-owned registration or secret.
export const XAI_PUBLIC_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const issuer = "https://auth.x.ai";
const scope = "openid profile email offline_access grok-cli:access api:access";
const tokensSchema = z.object({
	access_token: z.string().min(1),
	refresh_token: z.string().min(1).optional(),
	id_token: z.string().optional(),
	token_type: z.string().refine((v) => v.toLowerCase() === "bearer"),
	expires_in: z.number().positive().finite(),
	scope: z.string().optional(),
});
const deviceSchema = z.object({
	device_code: z.string().min(1),
	user_code: z.string().min(1).max(128),
	verification_uri: z.string().url(),
	expires_in: z.number().positive().max(3600),
	interval: z.number().int().positive().max(60).default(5),
});
const metadata = (r: ChatGPTRegistration): ModelConnection => ({
	provider: "supergrok",
	id: r.id,
	clientId: r.clientId,
	name: r.name,
	email: r.email,
	createdAt: r.createdAt,
	preferred: r.preferred,
	planNoticeSeen: true,
	authorized:
		!!r.accessToken &&
		!!r.refreshToken &&
		r.scope.split(/\s+/).includes("api:access"),
	status: !r.accessToken
		? "disconnected"
		: r.scope.split(/\s+/).includes("api:access")
			? "connected"
			: "permission-required",
});
export class GrokOAuth extends ConnectionRegistry {
	private readonly pending = new Map<string, AbortController>();
	private readonly keys;
	constructor(
		vault: ChatGPTVault,
		readonly clientId: string,
		private readonly fetcher: typeof fetch = fetch,
	) {
		super(vault);
		this.keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
			[customFetch]: fetcher,
		});
	}
	async list() {
		return (await this.vault.list()).map(metadata);
	}
	private async post(
		path: string,
		fields: Record<string, string>,
		signal?: AbortSignal,
	) {
		const response = await this.fetcher(`${issuer}/oauth2/${path}`, {
			method: "POST",
			redirect: "error",
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(10000)])
				: AbortSignal.timeout(10000),
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: new URLSearchParams(fields),
		});
		return response;
	}
	async connect(id?: string) {
		if (!this.clientId) throw new ModelAuthError("unavailable");
		const existing = id ? await this.vault.read(id) : null;
		if (id && !existing) throw new ModelAuthError("unknown_registration");
		const connectionId = id ?? `supergrok:${randomUUID()}`;
		const clientId = existing?.clientId ?? this.clientId;
		const abort = new AbortController();
		this.pending.get(connectionId)?.abort();
		this.pending.set(connectionId, abort);
		try {
			const response = await this.post(
				"device/code",
				{ client_id: clientId, scope },
				abort.signal,
			);
			if (!response.ok) throw new ModelAuthError("temporarily_unavailable");
			const device = deviceSchema.parse(await response.json());
			const url = new URL(device.verification_uri);
			if (
				url.protocol !== "https:" ||
				!["auth.x.ai", "accounts.x.ai"].includes(url.hostname) ||
				url.username ||
				url.password ||
				url.port
			)
				throw new ModelAuthError("verification_failed");
			const expiresAt = Date.now() + device.expires_in * 1000;
			const event: ModelSignInEvent = {
				_tag: "device",
				userCode: device.user_code,
				verificationUrl: device.verification_uri,
				expiresAt,
			};
			const finished = (async (): Promise<ModelConnection> => {
				let interval = device.interval * 1000;
				while (Date.now() < expiresAt) {
					await delay(Math.min(interval, expiresAt - Date.now()), undefined, {
						signal: abort.signal,
					});
					if (Date.now() >= expiresAt) break;
					const result = await this.post(
						"token",
						{
							grant_type: "urn:ietf:params:oauth:grant-type:device_code",
							client_id: clientId,
							device_code: device.device_code,
						},
						abort.signal,
					);
					const raw = await result.json();
					if (!result.ok) {
						const error = z.object({ error: z.string() }).parse(raw).error;
						if (error === "authorization_pending") continue;
						if (error === "slow_down") {
							interval += 5000;
							continue;
						}
						throw new ModelAuthError(
							error === "access_denied"
								? "access_denied"
								: error === "expired_token"
									? "timeout"
									: "verification_failed",
						);
					}
					const tokens = tokensSchema.parse(raw);
					if (!tokens.refresh_token || !tokens.id_token)
						throw new ModelAuthError("verification_failed");
					const { payload } = await jwtVerify(tokens.id_token, this.keys, {
						issuer,
						audience: clientId,
						algorithms: ["ES256"],
						requiredClaims: ["sub", "exp", "iat"],
					});
					if (!payload.sub || (existing && payload.sub !== existing.subject))
						throw new ModelAuthError("identity_mismatch");
					const subject = payload.sub;
					return await this.vault.lock(connectionId, async () => {
						abort.signal.throwIfAborted();
						const current = await this.vault.read(connectionId);
						if (
							(current?.authorizationGeneration ?? 0) !==
							(existing?.authorizationGeneration ?? 0)
						)
							throw new ModelAuthError("cancelled");
						const registration: ChatGPTRegistration = {
							id: connectionId,
							clientId,
							subject,
							...(typeof payload.email === "string" &&
							payload.email_verified === true
								? { email: payload.email }
								: {}),
							name: current?.name ?? "SuperGrok",
							createdAt: current?.createdAt ?? Date.now(),
							preferred: current?.preferred ?? false,
							planNoticeSeen: true,
							authorizationGeneration:
								(current?.authorizationGeneration ?? 0) + 1,
							scope: tokens.scope ?? "",
							accessToken: tokens.access_token,
							refreshToken: tokens.refresh_token,
							expiresAt: Date.now() + tokens.expires_in * 1000,
						};
						await this.vault.write(registration);
						return metadata(registration);
					});
				}
				throw new ModelAuthError("timeout");
			})().finally(() => {
				if (this.pending.get(connectionId) === abort)
					this.pending.delete(connectionId);
			});
			void finished.catch(() => {});
			return { event, finished, cancel: () => abort.abort() };
		} catch (error) {
			if (this.pending.get(connectionId) === abort)
				this.pending.delete(connectionId);
			abort.abort();
			throw error;
		}
	}
	async credential(id: string) {
		return this.vault.lock(id, async () => {
			const value = await this.vault.read(id);
			if (
				!value ||
				!metadata(value).authorized ||
				!value.accessToken ||
				!value.refreshToken
			)
				throw new ModelAuthError("reauthorization_required");
			if ((value.expiresAt ?? 0) > Date.now() + 60000)
				return { connectionId: id, accessToken: value.accessToken };
			const response = await this.post("token", {
				grant_type: "refresh_token",
				client_id: value.clientId,
				refresh_token: value.refreshToken,
			});
			if (!response.ok)
				throw new ModelAuthError(
					response.status >= 500
						? "temporarily_unavailable"
						: "reauthorization_required",
				);
			const tokens = tokensSchema.parse(await response.json());
			const refreshed = {
				...value,
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token ?? value.refreshToken,
				expiresAt: Date.now() + tokens.expires_in * 1000,
				scope: tokens.scope ?? value.scope,
			};
			await this.vault.write(refreshed);
			if (!metadata(refreshed).authorized)
				throw new ModelAuthError("reauthorization_required");
			return { connectionId: id, accessToken: refreshed.accessToken };
		});
	}
	async disconnect(id: string) {
		this.pending.get(id)?.abort();
		const value = await this.vault.lock(id, async () => {
			const current = await this.vault.read(id);
			if (!current) return null;
			const {
				accessToken: _access,
				refreshToken: _refresh,
				idToken: _id,
				expiresAt: _expires,
				...rest
			} = current;
			await this.vault.write({
				...rest,
				authorizationGeneration: (current.authorizationGeneration ?? 0) + 1,
			});
			return current;
		});
		if (!value?.refreshToken) return { revoked: true };
		try {
			return {
				revoked:
					(
						await this.post("revoke", {
							client_id: value.clientId,
							token: value.refreshToken,
							token_type_hint: "refresh_token",
						})
					).status === 200,
			};
		} catch {
			return { revoked: false };
		}
	}
	close() {
		for (const abort of this.pending.values()) abort.abort();
		this.pending.clear();
	}
}
