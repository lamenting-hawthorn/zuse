import type {
	ActorIdentity,
	ChatId,
	CollaborationAccessDeniedError,
	CollaborationAuditEvent,
	CollaborationConflictError,
	CollaborationInvite,
	CollaborationInviteInvalidError,
	CollaborationNotFoundError,
	CollaborationRole,
	CreatedCollaborationInvite,
	OrganizationDetails,
	Team,
	TeamId,
	TeamMember,
	TeamMemberId,
	WorkspaceGrant,
} from "@zuse/contracts";
import { Context, type Effect } from "effect";

export type CollaborationServiceError =
	| CollaborationAccessDeniedError
	| CollaborationConflictError
	| CollaborationInviteInvalidError
	| CollaborationNotFoundError;

export interface CollaborationProfile {
	readonly subject: string;
	readonly email: string;
	readonly displayName: string;
	readonly avatarUrl?: string | null;
}

export interface CollaborationServiceShape {
	/** Accepts a complete roster fetched by the trusted account API, never client-supplied claims. */
	readonly synchronizeOrganization: (
		details: OrganizationDetails,
	) => Effect.Effect<
		{ readonly team: Team; readonly actor: ActorIdentity },
		CollaborationServiceError
	>;
	readonly bootstrapTeam: (
		name: string,
		profile: CollaborationProfile,
	) => Effect.Effect<
		{
			readonly team: Team;
			readonly member: TeamMember;
			readonly actor: ActorIdentity;
		},
		CollaborationConflictError
	>;
	readonly resolveActor: (
		teamId: TeamId,
		subject: string,
	) => Effect.Effect<ActorIdentity, CollaborationAccessDeniedError>;
	readonly listMembers: (
		actor: ActorIdentity,
	) => Effect.Effect<ReadonlyArray<TeamMember>, CollaborationAccessDeniedError>;
	readonly changeMemberRole: (
		actor: ActorIdentity,
		memberId: TeamMemberId,
		role: CollaborationRole,
	) => Effect.Effect<TeamMember, CollaborationServiceError>;
	readonly revokeMember: (
		actor: ActorIdentity,
		memberId: TeamMemberId,
	) => Effect.Effect<TeamMember, CollaborationServiceError>;
	readonly createInvite: (
		actor: ActorIdentity,
		input: {
			readonly email?: string | null;
			readonly role: "driver" | "viewer";
			readonly expiresInMs: number;
		},
	) => Effect.Effect<
		CreatedCollaborationInvite,
		CollaborationAccessDeniedError | CollaborationConflictError
	>;
	readonly listInvites: (
		actor: ActorIdentity,
	) => Effect.Effect<
		ReadonlyArray<CollaborationInvite>,
		CollaborationAccessDeniedError
	>;
	readonly revokeInvite: (
		actor: ActorIdentity,
		inviteId: CollaborationInvite["id"],
	) => Effect.Effect<CollaborationInvite, CollaborationServiceError>;
	readonly redeemInvite: (
		token: string,
		profile: CollaborationProfile,
	) => Effect.Effect<
		{ readonly member: TeamMember; readonly actor: ActorIdentity },
		CollaborationInviteInvalidError | CollaborationConflictError
	>;
	readonly setWorkspaceGrant: (
		actor: ActorIdentity,
		chatId: ChatId,
		memberId: TeamMemberId,
		role: CollaborationRole,
	) => Effect.Effect<WorkspaceGrant, CollaborationServiceError>;
	readonly removeWorkspaceGrant: (
		actor: ActorIdentity,
		chatId: ChatId,
		memberId: TeamMemberId,
	) => Effect.Effect<void, CollaborationServiceError>;
	readonly listWorkspaceGrants: (
		actor: ActorIdentity,
		chatId: ChatId,
	) => Effect.Effect<ReadonlyArray<WorkspaceGrant>, CollaborationServiceError>;
	readonly requireWorkspaceRole: (
		actor: ActorIdentity,
		chatId: ChatId,
		minimumRole: CollaborationRole,
	) => Effect.Effect<WorkspaceGrant | null, CollaborationAccessDeniedError>;
	readonly listAuditEvents: (
		actor: ActorIdentity,
		limit?: number,
	) => Effect.Effect<
		ReadonlyArray<CollaborationAuditEvent>,
		CollaborationAccessDeniedError
	>;
}

export class CollaborationService extends Context.Service<
	CollaborationService,
	CollaborationServiceShape
>()("zuse/CollaborationService") {}
