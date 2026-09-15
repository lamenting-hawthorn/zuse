import { Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { ChatId } from "./ids.ts";

/** Organization administration is separate from private workspace permissions. */
export const OrganizationRole = Schema.Literals(["admin", "member"]);
export type OrganizationRole = typeof OrganizationRole.Type;
const Identifier = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(128),
);
export const OrganizationName = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(100),
);

export class Organization extends Schema.Class<Organization>("Organization")({
	id: Identifier,
	name: Schema.String,
	role: OrganizationRole,
}) {}

export class OrganizationMember extends Schema.Class<OrganizationMember>(
	"OrganizationMember",
)({
	id: Identifier,
	userId: Identifier,
	email: Schema.String,
	displayName: Schema.String,
	role: Schema.String,
	directoryManaged: Schema.Boolean,
}) {}

export class OrganizationInvitation extends Schema.Class<OrganizationInvitation>(
	"OrganizationInvitation",
)({
	id: Identifier,
	email: Schema.String,
	state: Schema.Literals(["pending", "accepted", "revoked", "expired"]),
	expiresAt: Schema.String,
}) {}

export class OrganizationDetails extends Schema.Class<OrganizationDetails>(
	"OrganizationDetails",
)({
	organization: Organization,
	currentUserId: Identifier,
	members: Schema.Array(OrganizationMember),
	invitations: Schema.Array(OrganizationInvitation),
}) {}

export class OrganizationError extends Schema.TaggedErrorClass<OrganizationError>()(
	"OrganizationError",
	{
		code: Schema.Literals([
			"not-allowed",
			"not-found",
			"conflict",
			"invalid-request",
			"unavailable",
		]),
	},
) {}

export const OrganizationCreateInput = Schema.Struct({
	name: OrganizationName,
	operationId: Schema.String.check(Schema.isUUID()),
});
export const OrganizationInviteInput = Schema.Struct({
	organizationId: Identifier,
	email: Schema.String.check(
		Schema.isMaxLength(254),
		Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u),
	),
	role: OrganizationRole,
});
export const OrganizationMemberInput = Schema.Struct({
	organizationId: Identifier,
	memberId: Identifier,
});
export const OrganizationRoleInput = Schema.Struct({
	...OrganizationMemberInput.fields,
	role: OrganizationRole,
});
export const OrganizationRevokeInviteInput = Schema.Struct({
	organizationId: Identifier,
	invitationId: Identifier,
});

export const OrganizationsListRpc = Rpc.make("organizations.list", {
	payload: Schema.Struct({}),
	success: Schema.Array(Organization),
	error: OrganizationError,
});

export const OrganizationsSetWorkspaceSharingRpc = Rpc.make(
	"organizations.setWorkspaceSharing",
	{
		payload: Schema.Struct({
			organizationId: Identifier,
			chatId: ChatId,
			shared: Schema.Boolean,
		}),
		success: Schema.Void,
		error: OrganizationError,
	},
);
export const OrganizationsCreateRpc = Rpc.make("organizations.create", {
	payload: OrganizationCreateInput,
	success: Organization,
	error: OrganizationError,
});
export const OrganizationsGetRpc = Rpc.make("organizations.get", {
	payload: Schema.Struct({ organizationId: Identifier }),
	success: OrganizationDetails,
	error: OrganizationError,
});
export const OrganizationsInviteRpc = Rpc.make("organizations.invite", {
	payload: OrganizationInviteInput,
	success: OrganizationInvitation,
	error: OrganizationError,
});
export const OrganizationsRevokeInviteRpc = Rpc.make(
	"organizations.revokeInvite",
	{
		payload: OrganizationRevokeInviteInput,
		success: Schema.Void,
		error: OrganizationError,
	},
);
export const OrganizationsSetRoleRpc = Rpc.make("organizations.setRole", {
	payload: OrganizationRoleInput,
	success: Schema.Void,
	error: OrganizationError,
});
export const OrganizationsRemoveMemberRpc = Rpc.make(
	"organizations.removeMember",
	{
		payload: OrganizationMemberInput,
		success: Schema.Void,
		error: OrganizationError,
	},
);
