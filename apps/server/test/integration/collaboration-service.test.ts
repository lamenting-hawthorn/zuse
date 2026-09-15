import {
	type ChatId,
	CollaborationAccessDeniedError,
	Organization,
	OrganizationDetails,
	OrganizationMember,
} from "@zuse/contracts";
import { layer as sqliteLayer } from "@zuse/sqlite";
import { Effect, Layer, ManagedRuntime, PubSub, Stream } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AuthTokenError } from "../../src/auth/errors.ts";
import { AuthService } from "../../src/auth/services/auth-service.ts";
import { CollaborationServiceLive } from "../../src/collaboration/layers/collaboration-service.ts";
import { CollaborationService } from "../../src/collaboration/services/collaboration-service.ts";
import { OrganizationAuthority } from "../../src/collaboration/services/organization-authority.ts";
import { WorkspaceSharingAuthorityLive } from "../../src/collaboration/services/workspace-sharing-authority.ts";
import { ConnectionIdentity } from "../../src/lan-auth/services/connection-identity.ts";
import { MigrationsLive } from "../../src/persistence/migrations.ts";

const makeRuntime = (
	authorized = () => true,
	membershipId = (organizationId: string, subject: string) =>
		`${organizationId}-${subject}`,
) => {
	const sqlite = sqliteLayer({ filename: ":memory:", disableWAL: true });
	const database = Layer.merge(
		sqlite,
		MigrationsLive.pipe(Layer.provide(sqlite)),
	);
	return ManagedRuntime.make(
		CollaborationServiceLive.pipe(
			Layer.provide(
				WorkspaceSharingAuthorityLive.pipe(
					Layer.provide(
						Layer.succeed(AuthService, {
							getSession: () => Effect.succeed({ _tag: "SignedOut" }),
							signIn: () => Effect.succeed({ _tag: "SignedOut" }),
							signOut: () => Effect.void,
							sessionChanges: () => Stream.empty,
							getAccessToken: () =>
								Effect.fail(new AuthTokenError({ reason: "Not signed in." })),
						}),
					),
				),
			),
			Layer.provideMerge(database),
			Layer.provide(
				Layer.succeed(OrganizationAuthority, {
					membership: (organizationId, subject) =>
						authorized()
							? Effect.succeed({
									role:
										subject === "owner"
											? ("owner" as const)
											: ("driver" as const),
									membershipId: membershipId(organizationId, subject),
								})
							: Effect.fail(
									new CollaborationAccessDeniedError({
										reason: "membership_not_active",
									}),
								),
				}),
			),
		),
	);
};

type TestRuntime = ReturnType<typeof makeRuntime>;

const ownerProfile = {
	subject: "oidc|owner",
	email: "OWNER@example.com",
	displayName: "Owner",
} as const;

const organizationRoster = (
	id: string,
	includeDriver = true,
	driverRole = "member",
) =>
	OrganizationDetails.make({
		organization: Organization.make({ id, name: id, role: "admin" }),
		currentUserId: "owner",
		members: [
			OrganizationMember.make({
				id: `${id}-owner`,
				userId: "owner",
				email: "owner@example.com",
				displayName: "Owner",
				role: "admin",
				directoryManaged: false,
			}),
			...(includeDriver
				? [
						OrganizationMember.make({
							id: `${id}-driver`,
							userId: "driver",
							email: "driver@example.com",
							displayName: "Driver",
							role: driverRole,
							directoryManaged: false,
						}),
					]
				: []),
		],
		invitations: [],
	});

describe("CollaborationService", () => {
	let runtime: TestRuntime;

	beforeEach(() => {
		runtime = makeRuntime();
	});

	afterEach(async () => {
		await runtime.dispose();
	});

	test("signals committed roster revocations without invalidating unchanged rosters", async () => {
		await runtime.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const service = yield* CollaborationService;
					const subscription = yield* service.subscribeAccessRevocations;
					const { team } = yield* service.synchronizeOrganization(
						organizationRoster("org-a"),
					);
					const driver = yield* service.resolveActor(team.id, "driver");
					yield* service.synchronizeOrganization(organizationRoster("org-a"));
					expect(yield* PubSub.takeUpTo(subscription, 10)).toEqual([]);
					yield* service.synchronizeOrganization(
						organizationRoster("org-a", false),
					);
					expect(yield* PubSub.takeUpTo(subscription, 10)).toEqual([
						{ kind: "member", memberId: driver.memberId },
					]);
					yield* service.synchronizeOrganization(
						organizationRoster("org-a", false),
					);
					expect(yield* PubSub.takeUpTo(subscription, 10)).toEqual([]);
				}),
			),
		);
	});

	test("rechecks live organization membership even when SQLite still records an owner", async () => {
		let authorized = true;
		const isolated = makeRuntime(() => authorized);
		try {
			await isolated.runPromise(
				Effect.gen(function* () {
					const service = yield* CollaborationService;
					const { actor } = yield* service.synchronizeOrganization(
						organizationRoster("org-a"),
					);
					yield* service.listMembers(actor);
					authorized = false;
					expect(
						(yield* service.listMembers(actor).pipe(Effect.flip)).reason,
					).toBe("membership_not_active");
				}),
			);
		} finally {
			await isolated.dispose();
		}
	});

	test("synchronizes WorkOS organizations idempotently without a second invitation authority", async () => {
		await runtime.runPromise(
			Effect.gen(function* () {
				const service = yield* CollaborationService;
				const first = yield* service.synchronizeOrganization(
					organizationRoster("org-a"),
				);
				const again = yield* service.synchronizeOrganization(
					organizationRoster("org-a"),
				);
				const other = yield* service.synchronizeOrganization(
					organizationRoster("org-b"),
				);
				expect(first.team.organizationId).toBe("org-a");
				expect(again.actor.memberId).toBe(first.actor.memberId);
				expect(other.team.id).not.toBe(first.team.id);
				expect(
					(yield* service.listAuditEvents(first.actor)).filter(
						(event) => event.action === "organization.synchronized",
					),
				).toHaveLength(1);
				const denied = yield* service
					.createInvite(first.actor, { role: "driver", expiresInMs: 60_000 })
					.pipe(Effect.flip);
				expect(denied.reason).toBe("membership_managed_by_workos");
			}),
		);
	});

	test("isolates organization workspaces even from other organization owners and clears revoked grants", async () => {
		await runtime.runPromise(
			Effect.gen(function* () {
				const service = yield* CollaborationService;
				const sql = yield* SqlClient.SqlClient;
				const first = yield* service.synchronizeOrganization(
					organizationRoster("org-a"),
				);
				const other = yield* service.synchronizeOrganization(
					organizationRoster("org-b"),
				);
				const driver = yield* service.resolveActor(first.team.id, "driver");
				const now = new Date().toISOString();
				yield* sql`INSERT INTO projects (id, path, name, created_at, updated_at) VALUES ('project-org', '/tmp/project-org', 'Org', ${now}, ${now})`;
				yield* sql`INSERT INTO chats (id, project_id, title, created_at, updated_at) VALUES ('chat-org', 'project-org', 'Private', ${now}, ${now})`;
				const chatId = "chat-org" as ChatId;
				expect(
					yield* service
						.getWorkspaceSharing(first.actor, chatId)
						.pipe(Effect.flip),
				).toMatchObject({ reason: "host_authorization_required" });
				expect(
					yield* service
						.getWorkspaceSharing(first.actor, chatId)
						.pipe(Effect.provideService(ConnectionIdentity, { kind: "local" })),
				).toEqual({ shared: false, grants: [] });
				expect(
					yield* service
						.setWorkspaceGrant(first.actor, chatId, driver.memberId, "driver")
						.pipe(Effect.flip),
				).toMatchObject({ reason: "workspace_not_shared" });
				expect(
					yield* service.shareWorkspace(first.actor, chatId).pipe(Effect.flip),
				).toMatchObject({ reason: "host_authorization_required" });
				expect(
					yield* service.shareWorkspace(first.actor, chatId).pipe(
						Effect.provideService(ConnectionIdentity, {
							kind: "account",
							subject: first.actor.subject,
							expiresAt: Date.now() + 60_000,
						}),
						Effect.flip,
					),
				).toMatchObject({ reason: "host_authorization_required" });
				yield* service
					.shareWorkspace(first.actor, chatId)
					.pipe(Effect.provideService(ConnectionIdentity, { kind: "local" }));
				expect(
					yield* service
						.shareWorkspace(other.actor, chatId)
						.pipe(
							Effect.provideService(ConnectionIdentity, { kind: "local" }),
							Effect.flip,
						),
				).toMatchObject({ reason: "workspace_belongs_to_another_team" });
				expect(
					yield* service
						.shareWorkspace(driver, chatId)
						.pipe(
							Effect.provideService(ConnectionIdentity, { kind: "local" }),
							Effect.flip,
						),
				).toMatchObject({ _tag: "CollaborationAccessDeniedError" });
				yield* service
					.shareWorkspace(first.actor, chatId)
					.pipe(Effect.provideService(ConnectionIdentity, { kind: "local" }));
				const sharingEvents =
					yield* sql`SELECT id FROM collaboration_audit_events WHERE action = 'workspace.shared' AND resource_id = ${chatId}`;
				expect(sharingEvents).toHaveLength(1);
				yield* service.setWorkspaceGrant(
					first.actor,
					chatId,
					driver.memberId,
					"driver",
				);
				const crossTeamInsert = yield* sql`INSERT INTO collaboration_chat_grants
					(team_id, chat_id, member_id, role, granted_by_member_id, created_at, updated_at)
					VALUES (${first.team.id}, ${chatId}, ${other.actor.memberId}, 'viewer', ${first.actor.memberId}, ${now}, ${now})`.pipe(
					Effect.flip,
				);
				expect(crossTeamInsert._tag).toBe("SqlError");
				const sharing = yield* service
					.getWorkspaceSharing(first.actor, chatId)
					.pipe(Effect.provideService(ConnectionIdentity, { kind: "local" }));
				expect(sharing.shared).toBe(true);
				expect(sharing.grants).toHaveLength(1);
				expect(sharing.grants[0]?.memberId).toBe(driver.memberId);
				expect(
					yield* service
						.getWorkspaceSharing(other.actor, chatId)
						.pipe(
							Effect.provideService(ConnectionIdentity, { kind: "local" }),
							Effect.flip,
						),
				).toMatchObject({ reason: "workspace_belongs_to_another_team" });
				expect(
					yield* service
						.unshareWorkspace(first.actor, chatId)
						.pipe(Effect.flip),
				).toMatchObject({ reason: "host_authorization_required" });
				yield* service
					.unshareWorkspace(first.actor, chatId)
					.pipe(Effect.provideService(ConnectionIdentity, { kind: "local" }));
				yield* service
					.unshareWorkspace(first.actor, chatId)
					.pipe(Effect.provideService(ConnectionIdentity, { kind: "local" }));
				expect(
					yield* sql`SELECT id FROM collaboration_audit_events WHERE action = 'workspace.unshared' AND resource_id = ${chatId}`,
				).toHaveLength(1);
				expect(
					yield* sql`SELECT id FROM chats WHERE id = ${chatId}`,
				).toHaveLength(1);
				expect(
					yield* service
						.getWorkspaceSharing(first.actor, chatId)
						.pipe(Effect.provideService(ConnectionIdentity, { kind: "local" })),
				).toEqual({ shared: false, grants: [] });
				expect(
					yield* service
						.requireWorkspaceRole(first.actor, chatId, "viewer")
						.pipe(Effect.flip),
				).toMatchObject({ reason: "workspace_role_required" });
				yield* service
					.shareWorkspace(first.actor, chatId)
					.pipe(Effect.provideService(ConnectionIdentity, { kind: "local" }));
				expect(
					yield* service
						.requireWorkspaceRole(driver, chatId, "viewer")
						.pipe(Effect.flip),
				).toMatchObject({ reason: "workspace_role_required" });
				yield* service.setWorkspaceGrant(
					first.actor,
					chatId,
					driver.memberId,
					"driver",
				);
				expect(
					(yield* service
						.requireWorkspaceRole(other.actor, chatId, "viewer")
						.pipe(Effect.flip)).reason,
				).toBe("workspace_role_required");
				expect(
					(yield* service
						.setWorkspaceGrant(
							other.actor,
							chatId,
							other.actor.memberId,
							"owner",
						)
						.pipe(Effect.flip))._tag,
				).toBe("CollaborationAccessDeniedError");
				yield* service.synchronizeOrganization(
					organizationRoster("org-a", false),
				);
				expect(
					(yield* service
						.requireWorkspaceRole(driver, chatId, "viewer")
						.pipe(Effect.flip))._tag,
				).toBe("CollaborationAccessDeniedError");
				yield* service.synchronizeOrganization(organizationRoster("org-a"));
				expect(
					(yield* service
						.requireWorkspaceRole(driver, chatId, "viewer")
						.pipe(Effect.flip)).reason,
				).toBe("workspace_role_required");
			}),
		);
	});

	test("a replacement WorkOS membership cannot inherit an old private grant even when removal was not observed", async () => {
		let replacement = false;
		const isolated = makeRuntime(
			() => true,
			(organizationId, subject) =>
				`${organizationId}-${subject}${replacement && subject === "driver" ? "-new" : ""}`,
		);
		try {
			await isolated.runPromise(
				Effect.gen(function* () {
					const service = yield* CollaborationService;
					const sql = yield* SqlClient.SqlClient;
					const roster = organizationRoster("org-a");
					const { actor, team } =
						yield* service.synchronizeOrganization(roster);
					const driver = yield* service.resolveActor(team.id, "driver");
					const now = new Date().toISOString();
					yield* sql`INSERT INTO projects (id, path, name, created_at, updated_at) VALUES ('project-rejoin', '/tmp/project-rejoin', 'Org', ${now}, ${now})`;
					yield* sql`INSERT INTO chats (id, project_id, title, created_at, updated_at) VALUES ('chat-rejoin', 'project-rejoin', 'Private', ${now}, ${now})`;
					const chatId = "chat-rejoin" as ChatId;
					yield* service
						.shareWorkspace(actor, chatId)
						.pipe(Effect.provideService(ConnectionIdentity, { kind: "local" }));
					yield* service.setWorkspaceGrant(
						actor,
						chatId,
						driver.memberId,
						"driver",
					);
					replacement = true;
					expect(
						(yield* service
							.requireWorkspaceRole(driver, chatId, "viewer")
							.pipe(Effect.flip)).reason,
					).toBe("organization_membership_changed");
					yield* service.synchronizeOrganization(
						OrganizationDetails.make({
							...roster,
							members: roster.members.map((member) =>
								member.userId === "driver"
									? OrganizationMember.make({
											...member,
											id: `${member.id}-new`,
										})
									: member,
							),
						}),
					);
					expect(
						(yield* service
							.requireWorkspaceRole(driver, chatId, "viewer")
							.pipe(Effect.flip)).reason,
					).toBe("workspace_role_required");
					yield* service.setWorkspaceGrant(
						actor,
						chatId,
						driver.memberId,
						"driver",
					);
					yield* service.requireWorkspaceRole(driver, chatId, "driver");
				}),
			);
		} finally {
			await isolated.dispose();
		}
	});

	test("maps unknown WorkOS roles to read-only and rejects incomplete rosters", async () => {
		await runtime.runPromise(
			Effect.gen(function* () {
				const service = yield* CollaborationService;
				const synced = yield* service.synchronizeOrganization(
					organizationRoster("org-a", true, "custom"),
				);
				expect(
					(yield* service.listMembers(synced.actor)).find(
						(member) => member.subject === "driver",
					)?.role,
				).toBe("viewer");
				expect(
					(yield* service
						.synchronizeOrganization(
							OrganizationDetails.make({
								...organizationRoster("org-a"),
								currentUserId: "missing",
							}),
						)
						.pipe(Effect.flip))._tag,
				).toBe("CollaborationAccessDeniedError");
			}),
		);
	});

	test("bootstraps exactly one team and normalizes the owner identity", async () => {
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const collaboration = yield* CollaborationService;
				return yield* collaboration.bootstrapTeam("  Acme  ", ownerProfile);
			}),
		);

		expect(result.team.name).toBe("Acme");
		expect(result.member.role).toBe("owner");
		expect(result.member.email).toBe("owner@example.com");

		await expect(
			runtime.runPromise(
				Effect.gen(function* () {
					const collaboration = yield* CollaborationService;
					return yield* collaboration.bootstrapTeam("Other", {
						subject: "oidc|other",
						email: "other@example.com",
						displayName: "Other",
					});
				}),
			),
		).rejects.toMatchObject({
			_tag: "CollaborationConflictError",
			reason: "team_already_bootstrapped",
		});
	});

	test("stores only an invite hash, binds email, and rejects replay", async () => {
		const { owner, invitation, storedToken } = await runtime.runPromise(
			Effect.gen(function* () {
				const collaboration = yield* CollaborationService;
				const sql = yield* SqlClient.SqlClient;
				const { actor: owner } = yield* collaboration.bootstrapTeam(
					"Acme",
					ownerProfile,
				);
				const invitation = yield* collaboration.createInvite(owner, {
					email: "DRIVER@example.com",
					role: "driver",
					expiresInMs: 60_000,
				});
				const rows = yield* sql<{ readonly token_hash: string }>`
					SELECT token_hash FROM collaboration_invites WHERE id = ${invitation.invite.id}
				`;
				return { owner, invitation, storedToken: rows[0]?.token_hash };
			}),
		);

		expect(invitation.token).toMatch(/^zinv_/);
		expect(storedToken).toHaveLength(64);
		expect(storedToken).not.toContain(invitation.token);

		await expect(
			runtime.runPromise(
				Effect.gen(function* () {
					const collaboration = yield* CollaborationService;
					return yield* collaboration.redeemInvite(invitation.token, {
						subject: "oidc|wrong-email",
						email: "wrong@example.com",
						displayName: "Wrong",
					});
				}),
			),
		).rejects.toMatchObject({
			_tag: "CollaborationInviteInvalidError",
			reason: "invite_email_mismatch",
		});

		const accepted = await runtime.runPromise(
			Effect.gen(function* () {
				const collaboration = yield* CollaborationService;
				return yield* collaboration.redeemInvite(invitation.token, {
					subject: "oidc|driver",
					email: "driver@example.com",
					displayName: "Driver",
				});
			}),
		);
		expect(accepted.member.role).toBe("driver");

		await expect(
			runtime.runPromise(
				Effect.gen(function* () {
					const collaboration = yield* CollaborationService;
					return yield* collaboration.redeemInvite(invitation.token, {
						subject: "oidc|replay",
						email: "driver@example.com",
						displayName: "Replay",
					});
				}),
			),
		).rejects.toMatchObject({
			_tag: "CollaborationInviteInvalidError",
			reason: "invite_invalid_or_expired",
		});

		const audit = await runtime.runPromise(
			Effect.gen(function* () {
				const collaboration = yield* CollaborationService;
				return yield* collaboration.listAuditEvents(owner);
			}),
		);
		expect(audit.map((event) => event.action)).toEqual(
			expect.arrayContaining([
				"team.created",
				"invite.created",
				"invite.accepted",
			]),
		);
	});

	test("preserves an active owner while allowing explicit ownership transfer", async () => {
		const { collaboration, owner, second, secondMember } =
			await runtime.runPromise(
				Effect.gen(function* () {
					const collaboration = yield* CollaborationService;
					const { actor: owner } = yield* collaboration.bootstrapTeam(
						"Acme",
						ownerProfile,
					);
					const invite = yield* collaboration.createInvite(owner, {
						role: "driver",
						expiresInMs: 60_000,
					});
					const { actor: second, member: secondMember } =
						yield* collaboration.redeemInvite(invite.token, {
							subject: "oidc|second-owner",
							email: "second@example.com",
							displayName: "Second Owner",
						});
					return { collaboration, owner, second, secondMember };
				}),
			);

		await expect(
			runtime.runPromise(
				collaboration.changeMemberRole(owner, owner.memberId, "driver"),
			),
		).rejects.toMatchObject({
			_tag: "CollaborationConflictError",
			reason: "last_owner_required",
		});

		await runtime.runPromise(
			collaboration.changeMemberRole(owner, secondMember.id, "owner"),
		);
		await runtime.runPromise(
			collaboration.changeMemberRole(second, owner.memberId, "driver"),
		);
		const revoked = await runtime.runPromise(
			collaboration.revokeMember(second, owner.memberId),
		);
		expect(revoked.status).toBe("revoked");
		await expect(
			runtime.runPromise(collaboration.listMembers(owner)),
		).rejects.toMatchObject({
			_tag: "CollaborationAccessDeniedError",
			reason: "actor_not_authorized",
		});
	});

	test("enforces team role ceilings, private grants, and revocation", async () => {
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const collaboration = yield* CollaborationService;
				const sql = yield* SqlClient.SqlClient;
				const { actor: owner } = yield* collaboration.bootstrapTeam(
					"Acme",
					ownerProfile,
				);
				const invitation = yield* collaboration.createInvite(owner, {
					role: "driver",
					expiresInMs: 60_000,
				});
				const { actor: driver, member } = yield* collaboration.redeemInvite(
					invitation.token,
					{
						subject: "oidc|driver",
						email: "driver@example.com",
						displayName: "Driver",
					},
				);
				const now = new Date().toISOString();
				yield* sql`
					INSERT INTO projects (id, path, name, created_at, updated_at)
					VALUES ('project-collab', '/tmp/project-collab', 'Project', ${now}, ${now})
				`;
				yield* sql`
					INSERT INTO chats (id, project_id, title, created_at, updated_at)
					VALUES ('chat-collab', 'project-collab', 'Private chat', ${now}, ${now})
				`;
				return { collaboration, owner, driver, member };
			}),
		);

		const chatId = "chat-collab" as ChatId;
		await runtime.runPromise(
			result.collaboration
				.shareWorkspace(result.owner, chatId)
				.pipe(Effect.provideService(ConnectionIdentity, { kind: "local" })),
		);
		await expect(
			runtime.runPromise(
				result.collaboration.requireWorkspaceRole(
					result.driver,
					chatId,
					"viewer",
				),
			),
		).rejects.toMatchObject({
			_tag: "CollaborationAccessDeniedError",
			reason: "workspace_role_required",
		});

		await expect(
			runtime.runPromise(
				result.collaboration.setWorkspaceGrant(
					result.owner,
					chatId,
					result.member.id,
					"owner",
				),
			),
		).rejects.toMatchObject({
			_tag: "CollaborationAccessDeniedError",
			reason: "grant_exceeds_team_role",
		});

		const grant = await runtime.runPromise(
			result.collaboration.setWorkspaceGrant(
				result.owner,
				chatId,
				result.member.id,
				"driver",
			),
		);
		expect(grant.role).toBe("driver");
		await expect(
			runtime.runPromise(
				result.collaboration.requireWorkspaceRole(
					result.driver,
					chatId,
					"driver",
				),
			),
		).resolves.toMatchObject({ role: "driver" });
		await expect(
			runtime.runPromise(
				result.collaboration.requireWorkspaceRole(
					result.driver,
					chatId,
					"owner",
				),
			),
		).rejects.toMatchObject({
			_tag: "CollaborationAccessDeniedError",
			reason: "workspace_role_required",
		});

		await runtime.runPromise(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient;
				yield* sql`
					UPDATE collaboration_members SET status = 'revoked'
					WHERE id = ${result.member.id}
				`;
			}),
		);
		await expect(
			runtime.runPromise(
				result.collaboration.requireWorkspaceRole(
					result.driver,
					chatId,
					"viewer",
				),
			),
		).rejects.toMatchObject({
			_tag: "CollaborationAccessDeniedError",
			reason: "actor_not_authorized",
		});
	});
});
