import { Schema } from "effect";

import {
	AgentSessionId,
	AuditEventId,
	ChatId,
	CollaborationInviteId,
	CollaborationLeaseId,
	CollaborationNoteId,
	CollaborativeDocumentId,
	PtyId,
	TeamId,
	TeamMemberId,
} from "./ids.ts";

const NonNegativeInt = Schema.Number.check(
	Schema.isInt(),
	Schema.isGreaterThanOrEqualTo(0),
);

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

export const CollaborationInviteStatus = Schema.Literals([
	"pending",
	"accepted",
	"revoked",
	"expired",
]);
export type CollaborationInviteStatus = typeof CollaborationInviteStatus.Type;

/** Public invitation metadata. The plaintext token is returned only on create. */
export class CollaborationInvite extends Schema.Class<CollaborationInvite>(
	"CollaborationInvite",
)({
	id: CollaborationInviteId,
	teamId: TeamId,
	email: Schema.NullOr(Schema.String),
	role: Schema.Literals(["driver", "viewer"]),
	status: CollaborationInviteStatus,
	createdByMemberId: TeamMemberId,
	expiresAt: Schema.DateFromString,
	acceptedByMemberId: Schema.NullOr(TeamMemberId),
	createdAt: Schema.DateFromString,
	updatedAt: Schema.DateFromString,
}) {}

export class CreatedCollaborationInvite extends Schema.Class<CreatedCollaborationInvite>(
	"CreatedCollaborationInvite",
)({
	invite: CollaborationInvite,
	token: Schema.String,
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

export const PresenceAvailability = Schema.Literals([
	"active",
	"idle",
	"offline",
]);
export type PresenceAvailability = typeof PresenceAvailability.Type;

/** Ephemeral visibility lease; subscription remains independent and durable. */
export class PresenceState extends Schema.Class<PresenceState>("PresenceState")(
	{
		teamId: TeamId,
		chatId: ChatId,
		memberId: TeamMemberId,
		deviceId: Schema.String,
		availability: PresenceAvailability,
		lastHumanActivityAt: Schema.DateFromString,
		heartbeatExpiresAt: Schema.DateFromString,
	},
) {}

export class TypingLease extends Schema.Class<TypingLease>("TypingLease")({
	chatId: ChatId,
	memberId: TeamMemberId,
	deviceId: Schema.String,
	expiresAt: Schema.DateFromString,
}) {}

export class AgentControlLease extends Schema.Class<AgentControlLease>(
	"AgentControlLease",
)({
	id: CollaborationLeaseId,
	chatId: ChatId,
	sessionId: AgentSessionId,
	controllerMemberId: TeamMemberId,
	controllerDeviceId: Schema.String,
	grantedByMemberId: TeamMemberId,
	acquiredAt: Schema.DateFromString,
	expiresAt: Schema.DateFromString,
}) {}

export class TerminalControlLease extends Schema.Class<TerminalControlLease>(
	"TerminalControlLease",
)({
	id: CollaborationLeaseId,
	chatId: ChatId,
	ptyId: PtyId,
	controllerMemberId: TeamMemberId,
	controllerDeviceId: Schema.String,
	grantedByMemberId: TeamMemberId,
	acquiredAt: Schema.DateFromString,
	expiresAt: Schema.DateFromString,
	disconnectGraceExpiresAt: Schema.NullOr(Schema.DateFromString),
}) {}

export class CollaborationNote extends Schema.Class<CollaborationNote>(
	"CollaborationNote",
)({
	id: CollaborationNoteId,
	teamId: TeamId,
	chatId: ChatId,
	author: ActorIdentity,
	body: Schema.String,
	mentionedMemberIds: Schema.Array(TeamMemberId),
	createdAt: Schema.DateFromString,
	editedAt: Schema.NullOr(Schema.DateFromString),
	deletedAt: Schema.NullOr(Schema.DateFromString),
}) {}

export class CollaborationUnreadCursor extends Schema.Class<CollaborationUnreadCursor>(
	"CollaborationUnreadCursor",
)({
	chatId: ChatId,
	memberId: TeamMemberId,
	lastReadSequence: NonNegativeInt,
	updatedAt: Schema.DateFromString,
}) {}

export const CollaborativeDocumentHealth = Schema.Literals([
	"healthy",
	"saving",
	"offline",
	"conflicted",
	"read_only",
]);
export type CollaborativeDocumentHealth =
	typeof CollaborativeDocumentHealth.Type;

export class CollaborativeDocumentRef extends Schema.Class<CollaborativeDocumentRef>(
	"CollaborativeDocumentRef",
)({
	id: CollaborativeDocumentId,
	teamId: TeamId,
	chatId: ChatId,
	relativePath: Schema.String,
	encoding: Schema.String,
	lineEnding: Schema.Literals(["lf", "crlf", "mixed"]),
	byteSize: NonNegativeInt,
	readOnlyReason: Schema.NullOr(Schema.String),
	health: CollaborativeDocumentHealth,
	updateCursor: NonNegativeInt,
	snapshotCursor: NonNegativeInt,
	lastDiskHash: Schema.String,
	updatedAt: Schema.DateFromString,
}) {}

export class CollaborativeDocumentUpdate extends Schema.Class<CollaborativeDocumentUpdate>(
	"CollaborativeDocumentUpdate",
)({
	documentId: CollaborativeDocumentId,
	cursor: NonNegativeInt,
	actorMemberId: Schema.NullOr(TeamMemberId),
	origin: Schema.Literals(["human", "server", "external"]),
	update: Schema.Uint8Array,
	createdAt: Schema.DateFromString,
}) {}

export class CollaborativeDocumentSnapshot extends Schema.Class<CollaborativeDocumentSnapshot>(
	"CollaborativeDocumentSnapshot",
)({
	documentId: CollaborativeDocumentId,
	cursor: NonNegativeInt,
	state: Schema.Uint8Array,
	createdAt: Schema.DateFromString,
}) {}

/** Awareness is intentionally ephemeral and never part of document history. */
export class CollaborativeAwarenessFrame extends Schema.Class<CollaborativeAwarenessFrame>(
	"CollaborativeAwarenessFrame",
)({
	documentId: CollaborativeDocumentId,
	memberId: TeamMemberId,
	deviceId: Schema.String,
	update: Schema.Uint8Array,
}) {}

export class ExternalFileChange extends Schema.Class<ExternalFileChange>(
	"ExternalFileChange",
)({
	documentId: CollaborativeDocumentId,
	baseDiskHash: Schema.String,
	newDiskHash: Schema.String,
	source: Schema.Literals(["agent", "cli", "git", "terminal", "unknown"]),
	detectedAt: Schema.DateFromString,
}) {}

export class CollaborativeMergeConflict extends Schema.Class<CollaborativeMergeConflict>(
	"CollaborativeMergeConflict",
)({
	documentId: CollaborativeDocumentId,
	baseText: Schema.String,
	currentText: Schema.String,
	externalText: Schema.String,
	externalDiskHash: Schema.String,
	detectedAt: Schema.DateFromString,
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

export class CollaborationInviteInvalidError extends Schema.TaggedErrorClass<CollaborationInviteInvalidError>()(
	"CollaborationInviteInvalidError",
	{ reason: Schema.String },
) {}

export type CollaborationError =
	| CollaborationAccessDeniedError
	| CollaborationNotFoundError
	| CollaborationConflictError
	| CollaborationInviteInvalidError;
