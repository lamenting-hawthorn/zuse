import type { OrganizationRole, WorkspaceScope } from "@zuse/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
	scope: { kind: "personal" } as WorkspaceScope,
	role: undefined as OrganizationRole | undefined,
}));
vi.mock("../../src/hooks/use-auth.ts", () => ({
	useAuth: () => ({
		isLoading: false,
		isSignedIn: true,
		signingIn: false,
		signIn: vi.fn(),
	}),
}));
vi.mock("../../src/lib/renderer-workspace.ts", () => ({
	rendererWorkspaceSnapshot: () => ({
		scope: fixture.scope,
		key:
			fixture.scope.kind === "personal"
				? "personal"
				: `organization:${fixture.scope.organizationId}`,
		epoch: 1,
	}),
	subscribeRendererWorkspace: () => () => {},
}));
vi.mock("../../src/lib/organization-workspaces.ts", () => ({
	useOrganizationWorkspaces: (
		select: (state: {
			organizations: ReadonlyArray<{
				id: string;
				name: string;
				role: OrganizationRole;
			}>;
		}) => unknown,
	) =>
		select({
			organizations:
				fixture.role === undefined
					? []
					: [{ id: "org_a", name: "Acme", role: fixture.role }],
		}),
}));

import { CloudWorkspacePool } from "../../src/components/settings/cloud-workspace-pool.tsx";

beforeEach(() => {
	fixture.scope = { kind: "personal" };
	fixture.role = undefined;
});

it("identifies Personal billing and preserves its checkout action", () => {
	const markup = renderToStaticMarkup(<CloudWorkspacePool section="billing" />);
	expect(markup).toContain("Cloud · Personal");
	expect(markup).toContain("Subscribe");
});

it.each([
	"admin",
	"billing",
	"member",
	undefined,
] as const)("identifies organization billing and limits financial actions for %s", (role) => {
	fixture.scope = { kind: "organization", organizationId: "org_a" };
	fixture.role = role;
	const markup = renderToStaticMarkup(<CloudWorkspacePool section="billing" />);
	expect(markup).toContain(`Cloud · ${role === undefined ? "org_a" : "Acme"}`);
	expect(markup).not.toContain("Cloud · Personal");
	if (role === "admin" || role === "billing") {
		expect(markup).toContain("Subscribe");
	} else {
		expect(markup).not.toContain("Subscribe");
		expect(markup).toContain("Only workspace admins and billing members");
	}
});
