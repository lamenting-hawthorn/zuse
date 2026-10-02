import { type ChatAccessPermission, ChatSharingPolicy } from "@zuse/contracts";
import { Effect, Schema } from "effect";
import type { CloudWorkspaceRecord } from "./cloud-workspace-store.ts";
import { forbidden } from "./errors.ts";
import {
	requireWorkspaceAccess,
	resolveWorkspaceActorAccess,
} from "./workspace-authorization.ts";
import { workspaceScopeForOwner } from "./workspace-scope.ts";

type WorkspaceAccess = Effect.Success<
	ReturnType<typeof requireWorkspaceAccess>
>;

/** Always resolve live membership before applying a chat's resource policy. */
export const cloudWorkspacePermission = Effect.fn("cloudWorkspacePermission")(
	function* (
		access: WorkspaceAccess,
		workspace: Pick<CloudWorkspaceRecord, "accountId" | "requestConfig">,
	) {
		if (workspace.accountId !== access.ownerId)
			return yield* forbidden("workspace_access_denied");
		if (access.membership === null)
			return { permission: "edit" as const, canManageSharing: true };
		const member = access.membership;
		if (member.role.slug === "admin")
			return { permission: "edit" as const, canManageSharing: true };
		if (member.role.slug !== "admin" && member.role.slug !== "member")
			return yield* forbidden("workspace_access_denied");
		const policy = yield* Schema.decodeUnknownEffect(ChatSharingPolicy)(
			workspace.requestConfig.sharingPolicy,
		).pipe(
			Effect.mapError(() => forbidden("workspace_sharing_policy_invalid")),
		);
		if (
			member.id === policy.creatorMembershipId &&
			access.actor.accountId === policy.creatorSubject
		)
			return { permission: "edit" as const, canManageSharing: true };
		const permissions: ChatAccessPermission[] = policy.grants
			.filter((grant) => grant.membershipId === member.id)
			.map((grant) => grant.permission);
		if (policy.audience === "organization") permissions.push(policy.permission);
		const permission: ChatAccessPermission | null = permissions.includes("edit")
			? "edit"
			: permissions.includes("view")
				? "view"
				: null;
		if (permission === null) return yield* forbidden("workspace_access_denied");
		return { permission, canManageSharing: false };
	},
);

export const requireCloudWorkspaceAccess = Effect.fn(
	"requireCloudWorkspaceAccess",
)(function* (
	request: Request,
	workspace: Pick<CloudWorkspaceRecord, "accountId" | "requestConfig">,
	action: "view" | "edit" | "sharing",
) {
	const access = yield* requireWorkspaceAccess(request, "content");
	const permission = yield* cloudWorkspacePermission(access, workspace);
	if (
		(action === "edit" && permission.permission !== "edit") ||
		(action === "sharing" && !permission.canManageSharing)
	)
		return yield* forbidden("workspace_access_denied");
	return { ...access, ...permission };
});

/** The caller must authenticate the runtime or verify the client ticket before supplying its actor. */
export const cloudWorkspaceActorPermission = Effect.fn(
	"cloudWorkspaceActorPermission",
)(function* (
	workspace: Pick<CloudWorkspaceRecord, "accountId" | "requestConfig">,
	subject: string,
	membershipId?: string,
) {
	const access = yield* resolveWorkspaceActorAccess(
		{ accountId: subject, orgId: undefined },
		workspaceScopeForOwner(workspace.accountId),
		"content",
	);
	if (membershipId !== undefined && access.membership?.id !== membershipId)
		return yield* forbidden("workspace_access_denied");
	const permission = yield* cloudWorkspacePermission(access, workspace);
	return {
		...permission,
		actor:
			access.membership === null
				? undefined
				: {
						subject: access.actor.accountId,
						membershipId: access.membership.id,
					},
	};
});
