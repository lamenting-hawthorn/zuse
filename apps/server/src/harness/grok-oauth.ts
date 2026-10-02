import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ModelConnection, ModelSignInEvent } from "@zuse/contracts";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { z } from "zod";
import {
	ConnectionRegistry,
	ModelAuthError,
	postOAuthForm,
} from "./connection-registry.ts";
import type { ModelRegistration, ModelVault } from "./connection-types.ts";

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
const metadata = (r: ModelRegistration): ModelConnection => ({
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
	private readonly keys;
	constructor(
		vault: ModelVault,
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
		return postOAuthForm(
			this.fetcher,
			`${issuer}/oauth2/${path}`,
			new URLSearchParams(fields),
			10000,
			signal,
		);
	}
	async connect(id?: string) {
		if (!this.clientId) throw new ModelAuthError("unavailable");
		const existing = id ? await this.vault.read(id) : null;
		if (id && !existing) throw new ModelAuthError("unknown_registration");
		const connectionId = id ?? `supergrok:${randomUUID()}`;
		const clientId = existing?.clientId ?? this.clientId;
		const abort = new AbortController();
		const cancel = () => abort.abort();
		this.replacePending(connectionId, cancel);
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
						const registration: ModelRegistration = {
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
				this.finishPending(connectionId, cancel);
			});
			void finished.catch(() => {});
			return { event, finished, cancel: () => abort.abort() };
		} catch (error) {
			this.finishPending(connectionId, cancel);
			abort.abort();
			throw error;
		}
	}
	async credential(id: string) {
		return this.credentialWith(
			id,
			(value) => metadata(value).authorized,
			async (value) => {
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
				return refreshed;
			},
		);
	}
	async disconnect(id: string) {
		return this.disconnectWith(
			id,
			async (value) =>
				(
					await this.post("revoke", {
						client_id: value.clientId,
						token: value.refreshToken,
						token_type_hint: "refresh_token",
					})
				).status === 200,
		);
	}
}
