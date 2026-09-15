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
	FolderId,
	OrganizationDetails,
	Team,
	TeamId,
	TeamMember,
	TeamMemberId,
	WorkspaceGrant,
} from "@zuse/contracts";
import { Context, type Effect, type PubSub, type Scope } from "effect";

export type CollaborationAccessRevocation =
	| { readonly kind: "workspace"; readonly chatId: ChatId }
	| { readonly kind: "member"; readonly memberId: TeamMemberId }
	| {
			readonly kind: "grant";
			readonly chatId: ChatId;
			readonly memberId: TeamMemberId;
	  };

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
	/** Verified account subject only; private/ungranted workspaces are excluded. */
	readonly visibleWorkspaces: (subject: string) => Effect.Effect<
		ReadonlyArray<{
			readonly chatId: ChatId;
			readonly projectId: FolderId;
		}>
	>;
	/** Apply only after the trusted account API confirms this membership mutation. */
	readonly applyOrganizationMembershipRestriction: (input: {
		readonly organizationId: string;
		readonly memberId: string;
		readonly change: "removed" | "demoted";
	}) => Effect.Effect<void>;
	/** Subscribe before checking access so revocation cannot race subscription startup. */
	readonly subscribeAccessRevocations: Effect.Effect<
		PubSub.Subscription<CollaborationAccessRevocation>,
		never,
		Scope.Scope
	>;
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
	/** Explicit host-owner opt-in. Organization ownership alone cannot claim a local chat. */
	readonly shareWorkspace: (
		actor: ActorIdentity,
		chatId: ChatId,
	) => Effect.Effect<void, CollaborationServiceError>;
	readonly unshareWorkspace: (
		actor: ActorIdentity,
		chatId: ChatId,
	) => Effect.Effect<void, CollaborationServiceError>;
	readonly removeWorkspaceGrant: (
		actor: ActorIdentity,
		chatId: ChatId,
		memberId: TeamMemberId,
	) => Effect.Effect<void, CollaborationServiceError>;
	readonly listWorkspaceGrants: (
		actor: ActorIdentity,
		chatId: ChatId,
	) => Effect.Effect<ReadonlyArray<WorkspaceGrant>, CollaborationServiceError>;
	readonly getWorkspaceSharing: (
		actor: ActorIdentity,
		chatId: ChatId,
	) => Effect.Effect<
		{
			readonly shared: boolean;
			readonly grants: ReadonlyArray<WorkspaceGrant>;
		},
		CollaborationServiceError
	>;
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
