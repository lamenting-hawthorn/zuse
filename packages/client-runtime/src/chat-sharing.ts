import type { ChatSharingPolicy, OrganizationMember } from "@zuse/contracts";

/** An explicit grant cannot reduce access already inherited by this member. */
export const fixedChatEditAccess = (
	policy: ChatSharingPolicy,
	member: Pick<OrganizationMember, "id" | "userId" | "role">,
): "admin" | "creator" | "organization" | null => {
	if (member.role === "admin") return "admin";
	if (member.role !== "member") return null;
	if (
		member.id === policy.creatorMembershipId &&
		member.userId === policy.creatorSubject
	)
		return "creator";
	return policy.audience === "organization" && policy.permission === "edit"
		? "organization"
		: null;
};
