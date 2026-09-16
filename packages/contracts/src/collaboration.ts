import { Schema } from "effect";

import { AuditEventId, ChatId, TeamId, TeamMemberId } from "./ids.ts";

/**
 * Team-wide authority. Resource grants may reduce a member's authority for a
 * private chat, but can never elevate it above this role.
 */
export const CollaborationRole = Schema.Literals(["owner", "driver", "viewer"]);
export type CollaborationRole = typeof CollaborationRole.Type;

export const TeamMemberStatus = Schema.Literals(["active", "revoked"]);
export type TeamMemberStatus = typeof TeamMemberStatus.Type;

/** Identity established by a trusted transport/OIDC boundary, never client claims. */
export class ActorIdentity extends Schema.Class<ActorIdentity>("ActorIdentity")(
	{
		memberId: TeamMemberId,
		teamId: TeamId,
		subject: Schema.String,
		email: Schema.String,
		displayName: Schema.String,
		avatarUrl: Schema.NullOr(Schema.String),
	},
) {}

export class Team extends Schema.Class<Team>("Team")({
	id: TeamId,
	organizationId: Schema.NullOr(Schema.String),
	name: Schema.String,
	createdAt: Schema.DateFromString,
	updatedAt: Schema.DateFromString,
}) {}

export class TeamMember extends Schema.Class<TeamMember>("TeamMember")({
	id: TeamMemberId,
	teamId: TeamId,
	subject: Schema.String,
	email: Schema.String,
	displayName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	role: CollaborationRole,
	status: TeamMemberStatus,
	joinedAt: Schema.DateFromString,
	updatedAt: Schema.DateFromString,
}) {}

/** Private-by-default access grant for Zuse's chat/worktree collaboration unit. */
export class WorkspaceGrant extends Schema.Class<WorkspaceGrant>(
	"WorkspaceGrant",
)({
	teamId: TeamId,
	chatId: ChatId,
	memberId: TeamMemberId,
	role: CollaborationRole,
	grantedByMemberId: TeamMemberId,
	createdAt: Schema.DateFromString,
	updatedAt: Schema.DateFromString,
}) {}

export const CollaborationAuditAction = Schema.Literals([
	"team.created",
	"organization.synchronized",
	"member.joined",
	"member.role_changed",
	"member.revoked",
	"invite.created",
	"invite.accepted",
	"invite.revoked",
	"workspace.grant_set",
	"workspace.shared",
	"workspace.unshared",
	"workspace.grant_removed",
]);
export type CollaborationAuditAction = typeof CollaborationAuditAction.Type;

export class CollaborationAuditEvent extends Schema.Class<CollaborationAuditEvent>(
	"CollaborationAuditEvent",
)({
	id: AuditEventId,
	teamId: TeamId,
	actorMemberId: Schema.NullOr(TeamMemberId),
	action: CollaborationAuditAction,
	resourceKind: Schema.String,
	resourceId: Schema.String,
	metadata: Schema.Record(Schema.String, Schema.Unknown),
	createdAt: Schema.DateFromString,
}) {}

export class CollaborationAccessDeniedError extends Schema.TaggedErrorClass<CollaborationAccessDeniedError>()(
	"CollaborationAccessDeniedError",
	{ reason: Schema.String },
) {}

export class CollaborationNotFoundError extends Schema.TaggedErrorClass<CollaborationNotFoundError>()(
	"CollaborationNotFoundError",
	{ resource: Schema.String },
) {}

export class CollaborationConflictError extends Schema.TaggedErrorClass<CollaborationConflictError>()(
	"CollaborationConflictError",
	{ reason: Schema.String },
) {}

export type CollaborationError =
	| CollaborationAccessDeniedError
	| CollaborationNotFoundError
	| CollaborationConflictError;
