import { ApiPaths } from "@zuse/contracts";
import { Effect } from "effect";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	hosted: true,
	request: vi.fn(),
	control: vi.fn(),
}));
vi.mock("../../src/lib/platform-capabilities.ts", () => ({
	isHostedProduct: () => mocks.hosted,
}));
vi.mock("../../src/lib/hosted-connect.ts", () => ({
	hostedAccountRequest: mocks.request,
}));
vi.mock("../../src/lib/control-plane-client.ts", () => ({
	runControlPlane: mocks.control,
}));

import { runOrganizations } from "../../src/lib/organization-client.ts";
import { observeRendererAccount } from "../../src/lib/renderer-account.ts";

beforeEach(() => {
	mocks.hosted = true;
	vi.resetAllMocks();
	observeRendererAccount(null);
	observeRendererAccount("guest");
});

it("uses the existing desktop RPC path, including its local authorization projection", async () => {
	mocks.hosted = false;
	mocks.control.mockImplementation((run) =>
		Effect.runPromise(run({ "organizations.list": () => Effect.succeed([]) })),
	);
	await expect(
		runOrganizations((client) => client["organizations.list"]({})),
	).resolves.toEqual([]);
	expect(mocks.control).toHaveBeenCalledOnce();
	expect(mocks.request).not.toHaveBeenCalled();
});

it("loads the browser account's organizations without any selected-host RPC", async () => {
	mocks.request.mockResolvedValue(
		Response.json([{ id: "org", name: "Team", role: "admin" }]),
	);
	await expect(
		runOrganizations((client) => client["organizations.list"]({})),
	).resolves.toMatchObject([{ id: "org", name: "Team" }]);
	expect(mocks.request).toHaveBeenCalledWith(
		ApiPaths.organizations,
		undefined,
		expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
	);
	expect(mocks.control).not.toHaveBeenCalled();
});

it("routes member and invitation mutations through the same authenticated account endpoint", async () => {
	mocks.request.mockImplementation(() =>
		Promise.resolve(Response.json({ ok: true })),
	);
	await runOrganizations((client) =>
		client["organizations.setRole"]({
			organizationId: "org",
			memberId: "member",
			role: "member",
		}),
	);
	await runOrganizations((client) =>
		client["organizations.removeMember"]({
			organizationId: "org",
			memberId: "member",
		}),
	);
	await runOrganizations((client) =>
		client["organizations.revokeInvite"]({
			organizationId: "org",
			invitationId: "invite",
		}),
	);
	expect(mocks.request.mock.calls.map(([path, body]) => [path, body])).toEqual([
		[
			ApiPaths.organizationSetRole,
			{ organizationId: "org", memberId: "member", role: "member" },
		],
		[
			ApiPaths.organizationRemoveMember,
			{ organizationId: "org", memberId: "member" },
		],
		[
			ApiPaths.organizationRevokeInvite,
			{ organizationId: "org", invitationId: "invite" },
		],
	]);
});

it("creates, loads, and invites using the existing contracts", async () => {
	const organization = { id: "org", name: "Team", role: "admin" };
	mocks.request.mockResolvedValueOnce(Response.json(organization));
	await expect(
		runOrganizations((client) =>
			client["organizations.create"]({
				name: "Team",
				operationId: "b4a97770-c98d-483b-87a0-aea06d585c50",
			}),
		),
	).resolves.toMatchObject(organization);
	mocks.request.mockResolvedValueOnce(
		Response.json({
			organization,
			currentUserId: "guest",
			members: [],
			invitations: [],
		}),
	);
	await expect(
		runOrganizations((client) =>
			client["organizations.get"]({ organizationId: "org" }),
		),
	).resolves.toMatchObject({ currentUserId: "guest" });
	const invite = {
		id: "invite",
		email: "teammate@example.test",
		state: "pending",
		expiresAt: "2030-01-01T00:00:00Z",
	};
	mocks.request.mockResolvedValueOnce(Response.json(invite));
	await expect(
		runOrganizations((client) =>
			client["organizations.invite"]({
				organizationId: "org",
				email: invite.email,
				role: "member",
			}),
		),
	).resolves.toMatchObject(invite);
	expect(mocks.request.mock.calls.map(([path, body]) => [path, body])).toEqual([
		[
			ApiPaths.organizations,
			{ name: "Team", operationId: "b4a97770-c98d-483b-87a0-aea06d585c50" },
		],
		[ApiPaths.organizationDetails, { organizationId: "org" }],
		[
			ApiPaths.organizationInvite,
			{ organizationId: "org", email: invite.email, role: "member" },
		],
	]);
});

it.each([
	[403, "not-allowed"],
	[404, "unavailable"],
	[409, "conflict"],
	[400, "invalid-request"],
	[503, "unavailable"],
])("normalizes HTTP %s without exposing provider response bodies", async (status, code) => {
	mocks.request.mockResolvedValue(
		Response.json({ secret: "provider-detail" }, { status: Number(status) }),
	);
	await expect(
		runOrganizations((client) => client["organizations.list"]({})),
	).rejects.toMatchObject({ _tag: "OrganizationError", code });
});

it("validates response contracts before publishing organization data", async () => {
	mocks.request.mockResolvedValue(Response.json([{ id: "org" }]));
	await expect(
		runOrganizations((client) => client["organizations.list"]({})),
	).rejects.toMatchObject({ code: "invalid-request" });
});

it("preserves auth failures even when the server returns a non-JSON body", async () => {
	mocks.request.mockResolvedValueOnce(
		new Response("Unauthorized", { status: 401 }),
	);
	await expect(
		runOrganizations((client) => client["organizations.list"]({})),
	).rejects.toMatchObject({ code: "not-allowed" });
});

it("preserves a missing individual organization while distinguishing the creation cap", async () => {
	mocks.request.mockResolvedValueOnce(
		Response.json(
			{ error: "organization_member_limit_reached" },
			{ status: 409 },
		),
	);
	await expect(
		runOrganizations((client) =>
			client["organizations.invite"]({
				organizationId: "org",
				email: "guest@example.com",
				role: "member",
			}),
		),
	).rejects.toMatchObject({ code: "organization-member-limit-reached" });
	mocks.request.mockResolvedValueOnce(Response.json({}, { status: 404 }));
	await expect(
		runOrganizations((client) =>
			client["organizations.get"]({ organizationId: "gone" }),
		),
	).rejects.toMatchObject({ code: "not-found" });
	mocks.request.mockResolvedValueOnce(
		Response.json({ error: "organization_limit_reached" }, { status: 409 }),
	);
	await expect(
		runOrganizations((client) =>
			client["organizations.create"]({
				name: "Second",
				operationId: "b4a97770-c98d-483b-87a0-aea06d585c50",
			}),
		),
	).rejects.toMatchObject({ code: "organization-limit-reached" });
});

it("does not send a mutation when the account changes while loading the browser adapter", async () => {
	const pending = runOrganizations((client) =>
		client["organizations.removeMember"]({
			organizationId: "org",
			memberId: "member",
		}),
	);
	observeRendererAccount("another-account");
	await expect(pending).rejects.toThrow("connection account changed");
	expect(mocks.request).not.toHaveBeenCalled();
});

it("discards an old account's response even when parsing finishes after the switch", async () => {
	const body = Promise.withResolvers<unknown>();
	const response = new Response();
	vi.spyOn(response, "json").mockReturnValue(body.promise);
	mocks.request.mockResolvedValue(response);
	const pending = runOrganizations((client) =>
		client["organizations.list"]({}),
	);
	await vi.waitFor(() => expect(response.json).toHaveBeenCalledOnce());
	observeRendererAccount("another-account");
	body.resolve([]);
	await expect(pending).rejects.toThrow("connection account changed");
});
