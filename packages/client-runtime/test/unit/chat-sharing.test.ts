import type { ChatSharingPolicy } from "@zuse/contracts";
import { expect, it } from "vitest";
import { fixedChatEditAccess } from "../../src/chat-sharing.ts";

const policy: ChatSharingPolicy = {
	audience: "private",
	permission: "view",
	creatorSubject: "creator",
	creatorMembershipId: "membership",
	grants: [],
};

it.each([
	{ role: "admin", id: "other", userId: "other", expected: "admin" },
	{ role: "member", id: "membership", userId: "creator", expected: "creator" },
	{ role: "member", id: "membership", userId: "other", expected: null },
	{ role: "member", id: "other", userId: "creator", expected: null },
	{ role: "billing", id: "membership", userId: "creator", expected: null },
])("projects fixed access for $role/$id/$userId", ({ expected, ...member }) => {
	expect(fixedChatEditAccess(policy, member)).toBe(expected);
});

it.each([
	"admin",
	"member",
	"billing",
	"unknown",
])("handles organization edit access for %s", (role) => {
	const member = { role, id: "other", userId: "other" };
	expect(
		fixedChatEditAccess(
			{ ...policy, audience: "organization", permission: "edit" },
			member,
		),
	).toBe(
		role === "admin" ? "admin" : role === "member" ? "organization" : null,
	);
});
