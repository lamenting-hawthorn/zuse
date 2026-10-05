import {
	ApiPaths,
	type OrganizationGithubDiscovery,
	OrganizationGithubInput,
	OrganizationGithubJoinInput,
	OrganizationGithubPolicyInput,
	OrganizationGithubRestoreInput,
} from "@zuse/contracts";
import { BROWSER_PAGE_HEADERS } from "@zuse/utils/browser-page";
import { renderIntegrationPage } from "@zuse/utils/integration-page";
import { Clock, Effect, Schema } from "effect";
import { requireWorkos } from "./auth.ts";
import { CloudWorkspaceStore } from "./cloud-workspace-store.ts";
import { ApiConfiguration } from "./config.ts";
import {
	badRequest,
	conflict,
	forbidden,
	notFound,
	serviceUnavailable,
} from "./errors.ts";
import { githubMemberEligible } from "./github-membership.ts";
import {
	exchangeGithubCode,
	githubRequest,
	readGithubInstallation,
} from "./github-transport.ts";
import { decodeBody, json } from "./http.ts";
import {
	listWorkos,
	organizationSeatsFull,
	requestWorkos,
	WorkosMember,
	WorkosOrganization,
	WorkosUser,
} from "./organization-workos.ts";
import { requireOrganizationMember } from "./organizations.ts";
import { ApiStore } from "./store.ts";

const cookieName = "zuse_github_join";
const callbackUrl = Effect.gen(function* () {
	const config = yield* ApiConfiguration;
	return new URL(
		ApiPaths.organizationGithubCallback,
		config.publicApiOrigin ?? config.apiIssuer,
	).toString();
});
const membershipsFor = (accountId: string, organizationId: string) =>
	listWorkos(
		`/user_management/organization_memberships?organization_id=${encodeURIComponent(organizationId)}&user_id=${encodeURIComponent(accountId)}`,
		WorkosMember,
	).pipe(
		Effect.map((rows) =>
			rows.filter(
				(m) => m.organization_id === organizationId && m.user_id === accountId,
			),
		),
	);

export const routeGithubOrganizationRequest = Effect.fn(
	"routeGithubOrganizationRequest",
)(function* (request: Request) {
	const url = new URL(request.url);
	if (!url.pathname.startsWith(`${ApiPaths.organizations}/github/`))
		return null;
	const config = yield* ApiConfiguration;
	if (!config.organizationWorkspacesEnabled)
		return yield* forbidden("organization_workspaces_disabled");
	const store = yield* ApiStore;
	const joining = store.githubJoining;
	if (
		url.pathname === ApiPaths.organizationGithubCallback &&
		request.method === "GET"
	) {
		const state = url.searchParams.get("state");
		if (!state || !/^user_[A-Za-z0-9]+:[0-9a-f-]{36}$/u.test(state))
			return yield* badRequest("invalid_github_join_state");
		const callback = yield* callbackUrl;
		const code = url.searchParams.get("code");
		if (!code && !url.searchParams.has("error")) {
			if (!config.githubApp?.clientId)
				return yield* serviceUnavailable("github_app_oauth_not_configured");
			const authorize = new URL("https://github.com/login/oauth/authorize");
			authorize.searchParams.set("client_id", config.githubApp.clientId);
			authorize.searchParams.set("redirect_uri", callback);
			authorize.searchParams.set("state", state);
			return new Response(null, {
				status: 302,
				headers: {
					...BROWSER_PAGE_HEADERS,
					location: authorize.toString(),
					"set-cookie": `${cookieName}=${state}; HttpOnly; Secure; SameSite=Lax; Path=${ApiPaths.organizationGithubCallback}; Max-Age=600`,
				},
			});
		}
		if (
			!(request.headers.get("cookie") ?? "")
				.split(";")
				.some((c) => c.trim() === `${cookieName}=${state}`)
		)
			return yield* badRequest("invalid_github_browser_state");
		const [accountId, nonce] = state.split(":");
		if (!accountId || !nonce)
			return yield* badRequest("invalid_github_join_state");
		const challenge = yield* store.consumeChallenge(
			`github-join:${nonce}`,
			accountId,
		);
		if (
			!challenge ||
			challenge.challenge !== state ||
			challenge.apiIssuer !== config.apiIssuer ||
			challenge.expiresAtMs <= (yield* Clock.currentTimeMillis)
		)
			return yield* badRequest("invalid_github_join_state");
		if (!code || url.searchParams.has("error"))
			return yield* badRequest("github_authorization_denied");
		const token = yield* exchangeGithubCode(code, callback);
		const raw = yield* githubRequest<unknown>(
			"https://api.github.com/user",
			token.access_token,
			{ signal: AbortSignal.timeout(5_000) },
		);
		const user = yield* Schema.decodeUnknownEffect(
			Schema.Struct({
				id: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
				login: Schema.String,
			}),
		)(raw).pipe(Effect.mapError(() => badRequest("github_identity_invalid")));
		const organizationIds: number[] = [];
		for (let page = 1; ; page++) {
			if (page > 100)
				return yield* serviceUnavailable("github_roster_too_large");
			const rawMemberships = yield* githubRequest<unknown>(
				`https://api.github.com/user/memberships/orgs?per_page=100&page=${page}`,
				token.access_token,
				{ signal: AbortSignal.timeout(5_000) },
			);
			const memberships = yield* Schema.decodeUnknownEffect(
				Schema.Array(
					Schema.Struct({
						state: Schema.String,
						organization: Schema.Struct({ id: Schema.Number }),
					}),
				),
			)(rawMemberships).pipe(
				Effect.mapError(() => serviceUnavailable("github_members_invalid")),
			);
			organizationIds.push(
				...memberships
					.filter((m) => m.state === "active")
					.map((m) => m.organization.id),
			);
			if (memberships.length < 100) break;
		}
		if (
			!(yield* joining.saveIdentity({
				accountId: accountId,
				githubUserId: user.id,
				organizationIds,
				verificationId: nonce,
				login: user.login,
			}))
		)
			return yield* conflict("github_identity_already_linked");
		return new Response(
			renderIntegrationPage({
				integration: "GitHub",
				title: "GitHub verified",
				status: "Verified",
				description: "Return to Zuse to find and join your organization.",
				hint: "You can close this tab.",
				actions: [],
			}),
			{
				headers: {
					...BROWSER_PAGE_HEADERS,
					"set-cookie": `${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=${ApiPaths.organizationGithubCallback}; Max-Age=0`,
				},
			},
		);
	}
	const { accountId } = yield* requireWorkos(request);
	if (request.method !== "POST") return yield* notFound();
	if (url.pathname === ApiPaths.organizationGithubAuthorize) {
		if (!config.githubApp?.clientId || !config.githubApp.clientSecret)
			return yield* serviceUnavailable("github_app_oauth_not_configured");
		const nonce = crypto.randomUUID();
		const state = `${accountId}:${nonce}`;
		yield* store.createChallenge({
			challengeId: `github-join:${nonce}`,
			accountId,
			challenge: state,
			apiIssuer: config.apiIssuer,
			expiresAtMs: (yield* Clock.currentTimeMillis) + 600_000,
		});
		const target = new URL(yield* callbackUrl);
		target.searchParams.set("state", state);
		return json({ url: target.toString(), attemptId: nonce });
	}
	if (url.pathname === ApiPaths.organizationGithubSettings) {
		const { organizationId } = yield* decodeBody(
			OrganizationGithubInput,
			request,
		);
		yield* requireOrganizationMember(accountId, organizationId, true);
		const connections =
			yield* (yield* CloudWorkspaceStore).listGithubInstallations(
				`organization:${organizationId}`,
			);
		const policies = yield* joining.listPolicies({ organizationId });
		const blockedMembers = yield* Effect.forEach(
			(yield* joining.listEnrollments(organizationId)).filter((e) => e.blocked),
			(e) =>
				requestWorkos(
					`/user_management/users/${encodeURIComponent(e.accountId)}`,
					WorkosUser,
				).pipe(
					Effect.map((user) => ({
						accountId: e.accountId,
						displayName: user.email,
					})),
				),
			{ concurrency: 4 },
		);
		return json({
			installations: connections
				.filter((c) => c.accountType === "Organization")
				.map((c) => ({
					installationId: c.installationId,
					login: c.accountLogin,
					suspended: c.suspended,
					enabled: policies.some(
						(p) =>
							p.organizationId === organizationId &&
							p.installationId === c.installationId &&
							p.enabled,
					),
				})),
			blockedMembers,
		});
	}
	if (url.pathname === ApiPaths.organizationGithubPolicy) {
		const input = yield* decodeBody(OrganizationGithubPolicyInput, request);
		return yield* store.withOrganizationLock(
			input.organizationId,
			Effect.gen(function* () {
				yield* requireOrganizationMember(accountId, input.organizationId, true);
				const connection =
					(yield* (yield* CloudWorkspaceStore).listGithubInstallations(
						`organization:${input.organizationId}`,
					)).find(
						(c) =>
							c.installationId === input.installationId &&
							c.accountType === "Organization",
					);
				if (!connection)
					return yield* forbidden("github_installation_not_connected");
				const installation = yield* readGithubInstallation(
					input.installationId,
				);
				if (
					installation.account.id !== connection.githubAccountId ||
					installation.account.type !== "Organization" ||
					(input.enabled && installation.suspended_at !== null)
				)
					return yield* forbidden("github_installation_unavailable");
				const policy = {
					organizationId: input.organizationId,
					installationId: input.installationId,
					githubOrgId: connection.githubAccountId,
					login: installation.account.login,
					enabled: input.enabled,
					revision: crypto.randomUUID(),
				};
				// A complete roster read proves Members permission before enabling discovery.
				if (input.enabled) yield* githubMemberEligible(policy, -1);
				yield* joining.savePolicy(policy);
				return json({ ok: true });
			}),
		);
	}
	if (url.pathname === ApiPaths.organizationGithubRestore) {
		const input = yield* decodeBody(OrganizationGithubRestoreInput, request);
		return yield* store.withOrganizationLock(
			input.organizationId,
			Effect.gen(function* () {
				yield* requireOrganizationMember(accountId, input.organizationId, true);
				const e = yield* joining.getEnrollment(
					input.organizationId,
					input.accountId,
				);
				if (!e) return yield* notFound();
				// Finish a previously interrupted removal before allowing a new seat claim.
				if (e.blocked)
					for (const m of yield* membershipsFor(
						input.accountId,
						input.organizationId,
					))
						if (m.status === "active")
							yield* requestWorkos(
								`/user_management/organization_memberships/${encodeURIComponent(m.id)}/deactivate`,
								WorkosMember,
								"PUT",
								{},
							);
				yield* joining.saveEnrollment({
					...e,
					blocked: false,
					revision: crypto.randomUUID(),
				});
				return json({ ok: true });
			}),
		);
	}
	const identity = yield* joining.getIdentity(accountId);
	if (url.pathname === ApiPaths.organizationGithubDiscover) {
		if (!identity) return json({ connected: false, organizations: [] });
		const organizations: Array<
			(typeof OrganizationGithubDiscovery.Type.organizations)[number]
		> = [];
		for (const policy of yield* joining.listPolicies({
			githubOrgIds: identity.organizationIds,
		})) {
			if (
				!policy.enabled ||
				organizations.some(
					(org) => org.organizationId === policy.organizationId,
				)
			)
				continue;
			const enrollment = yield* joining.getEnrollment(
				policy.organizationId,
				accountId,
			);
			if (
				enrollment?.blocked ||
				!(yield* githubMemberEligible(policy, identity.githubUserId).pipe(
					Effect.catch((error) =>
						error.code === "github_installation_unavailable"
							? Effect.succeed(false)
							: Effect.fail(error),
					),
				))
			)
				continue;
			const org = yield* requestWorkos(
				`/organizations/${encodeURIComponent(policy.organizationId)}`,
				WorkosOrganization,
			);
			const joined = (yield* membershipsFor(
				accountId,
				policy.organizationId,
			)).some((m) => m.status === "active");
			organizations.push({
				organizationId: org.id,
				name: org.name,
				installationId: policy.installationId,
				githubLogin: policy.login,
				state: joined
					? "joined"
					: (yield* organizationSeatsFull(org.id, accountId))
						? "full"
						: "available",
			});
		}
		return json({
			connected: true,
			verificationId: identity.verificationId,
			organizations,
		});
	}
	if (url.pathname === ApiPaths.organizationGithubJoin) {
		const input = yield* decodeBody(OrganizationGithubJoinInput, request);
		if (!identity) return yield* forbidden("github_identity_required");
		// Commit enrollment intent and its seat reservation before calling WorkOS.
		// This uses the existing one-connection transaction lock without a second
		// database connection or a transaction spanning both durable writes.
		const prepared = yield* store.withOrganizationLock(
			input.organizationId,
			Effect.gen(function* () {
				const policy = (yield* joining.listPolicies({
					organizationId: input.organizationId,
				})).find(
					(p) =>
						p.organizationId === input.organizationId &&
						p.installationId === input.installationId &&
						p.enabled,
				);
				const enrollment = yield* joining.getEnrollment(
					input.organizationId,
					accountId,
				);
				if (
					!policy ||
					enrollment?.blocked ||
					!(yield* githubMemberEligible(policy, identity.githubUserId))
				)
					return yield* forbidden("organization_access_denied");
				const memberships = yield* membershipsFor(
					accountId,
					input.organizationId,
				);
				const active = memberships.find((m) => m.status === "active");
				if (active) return null; // Never convert a manually admitted membership.
				if (!enrollment && memberships.length > 0)
					return yield* forbidden("organization_access_denied");
				if (yield* organizationSeatsFull(input.organizationId, accountId))
					return yield* conflict("organization_member_limit_reached");
				const pending = {
					organizationId: input.organizationId,
					accountId,
					githubUserId: identity.githubUserId,
					installationId: policy.installationId,
					githubOrgId: policy.githubOrgId,
					blocked: false,
					memberId: enrollment?.memberId ?? null,
					reservedUntil: (yield* Clock.currentTimeMillis) + 600_000,
					revision: crypto.randomUUID(),
				};
				yield* joining.saveEnrollment(pending);
				return pending;
			}),
		);
		if (!prepared) return json({ ok: true });
		return yield* store.withOrganizationLock(
			input.organizationId,
			Effect.gen(function* () {
				const enrollment = yield* joining.getEnrollment(
					input.organizationId,
					accountId,
				);
				const policy = (yield* joining.listPolicies({
					organizationId: input.organizationId,
				})).find(
					(p) =>
						p.organizationId === input.organizationId &&
						p.installationId === input.installationId &&
						p.enabled,
				);
				if (
					!enrollment ||
					enrollment.installationId !== input.installationId ||
					enrollment.blocked ||
					!policy ||
					!(yield* githubMemberEligible(policy, identity.githubUserId))
				)
					return yield* forbidden("organization_access_denied");
				const memberships = yield* membershipsFor(
					accountId,
					input.organizationId,
				);
				const active = memberships.find((m) => m.status === "active");
				if (active) {
					yield* joining.saveEnrollment({
						...enrollment,
						memberId: active.id,
						reservedUntil: 0,
					});
					return json({ ok: true });
				}
				if (yield* organizationSeatsFull(input.organizationId, accountId))
					return yield* conflict("organization_member_limit_reached");
				const previous = memberships.find(
					(m) =>
						m.status === "inactive" &&
						!m.directory_managed &&
						m.role.slug === "member",
				);
				const member = previous
					? yield* requestWorkos(
							`/user_management/organization_memberships/${encodeURIComponent(previous.id)}/reactivate`,
							WorkosMember,
							"PUT",
							{},
						)
					: yield* requestWorkos(
							"/user_management/organization_memberships",
							WorkosMember,
							"POST",
							{
								organization_id: input.organizationId,
								user_id: accountId,
								role_slug: "member",
							},
						);
				yield* joining.saveEnrollment({
					...enrollment,
					memberId: member.id,
					reservedUntil: 0,
				});
				return json({ ok: true });
			}),
		);
	}
	return yield* notFound();
});
