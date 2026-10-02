import {
	ApiPaths,
	Organization,
	type OrganizationCreateInput,
	OrganizationDetails,
	OrganizationInvitation,
	type OrganizationInviteInput,
	type OrganizationMemberInput,
	type OrganizationRevokeInviteInput,
	type OrganizationRoleInput,
} from "@zuse/contracts";
import { Effect, Schema } from "effect";

/** Membership administration is account-scoped; organization IDs stay in the payload. */
export type OrganizationControlRequest<E> = <A>(
	path: string,
	schema: Schema.Codec<A, unknown>,
	body?: unknown,
) => Effect.Effect<A, E>;

const acknowledgement = Schema.Struct({ ok: Schema.Literal(true) });

export const makeOrganizationControlClient = <E>(
	request: OrganizationControlRequest<E>,
) => ({
	"organizations.list": (_input: Record<string, never>) =>
		request(ApiPaths.organizations, Schema.Array(Organization)),
	"organizations.get": (input: { organizationId: string }) =>
		request(ApiPaths.organizationDetails, OrganizationDetails, input),
	"organizations.create": (input: typeof OrganizationCreateInput.Type) =>
		request(ApiPaths.organizations, Organization, input),
	"organizations.invite": (input: typeof OrganizationInviteInput.Type) =>
		request(ApiPaths.organizationInvite, OrganizationInvitation, input),
	"organizations.revokeInvite": (
		input: typeof OrganizationRevokeInviteInput.Type,
	) =>
		request(ApiPaths.organizationRevokeInvite, acknowledgement, input).pipe(
			Effect.asVoid,
		),
	"organizations.setRole": (input: typeof OrganizationRoleInput.Type) =>
		request(ApiPaths.organizationSetRole, acknowledgement, input).pipe(
			Effect.asVoid,
		),
	"organizations.removeMember": (input: typeof OrganizationMemberInput.Type) =>
		request(ApiPaths.organizationRemoveMember, acknowledgement, input).pipe(
			Effect.asVoid,
		),
});
