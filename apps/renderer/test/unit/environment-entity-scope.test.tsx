import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	environmentId: "local",
	requested: [] as Array<string | null>,
}));
vi.mock("../../src/store/environment-catalog.ts", () => ({
	useEnvironmentCatalogStore: (
		selector: (value: { activeEnvironmentId: string }) => unknown,
	) => selector({ activeEnvironmentId: state.environmentId }),
}));
vi.mock("../../src/lib/environment-shell-client-bus.ts", () => ({
	useEnvironmentShellResource: (environmentId: string | null) => {
		state.requested.push(environmentId);
		return {
			data:
				environmentId === null
					? null
					: {
							folders: [{ name: "Secret repository" }],
							chatsByProject: { repo: [{ title: "Secret chat" }] },
							sessionsByProject: {},
							originsByFolder: {},
							creationOperationsByProject: {},
						},
		};
	},
}));

import {
	useActiveEnvironmentEntities,
	useEnvironmentEntities,
} from "../../src/lib/environment-entity-hooks.ts";
import {
	observeRendererAccount,
	rendererAccountSnapshot,
} from "../../src/lib/renderer-account.ts";
import { selectRendererWorkspace } from "../../src/lib/renderer-workspace.ts";
import { registerCloudWorkspace } from "../../src/lib/rpc-client.ts";

const Content = ({ background = false }: { background?: boolean }) => {
	const visible = useActiveEnvironmentEntities();
	const explicit = useEnvironmentEntities("local", background);
	const entities = background ? explicit : visible;
	return (
		<div>
			{entities.folders.map((folder) => folder.name).join(",")}
			{Object.values(entities.chatsByProject)
				.flat()
				.map((chat) => chat.title)
				.join(",")}
		</div>
	);
};

beforeEach(() => {
	observeRendererAccount(null);
	observeRendererAccount("alice");
	selectRendererWorkspace({ kind: "personal" });
	state.environmentId = "local";
	state.requested = [];
});

it("hides Personal chat and repository data immediately in an organization", () => {
	expect(renderToStaticMarkup(<Content />)).toContain("Secret chat");
	selectRendererWorkspace({ kind: "organization", organizationId: "org-a" });
	state.requested = [];
	expect(renderToStaticMarkup(<Content />)).toBe("<div></div>");
	expect(state.requested.every((ref) => ref === null)).toBe(true);
	selectRendererWorkspace({ kind: "personal" });
	expect(renderToStaticMarkup(<Content />)).toContain("Secret repository");
});

it("keeps explicitly scoped background activity independent of the selected workspace", () => {
	selectRendererWorkspace({ kind: "organization", organizationId: "org-a" });
	expect(renderToStaticMarkup(<Content background />)).toContain("Secret chat");
});

it("shows a registered cloud environment only in its owning organization", () => {
	const ticket = {
		workspaceId: "cloud-a",
		workspaceScope: { kind: "organization" as const, organizationId: "org-a" },
		wsUrl: "wss://example.test/cloud",
		protocol: "zuse-workspace-v1",
		role: "client" as const,
		generation: 1,
		gatewayEpoch: 1,
		credential: "test-ticket",
		expiresAt: Date.now() + 60_000,
	};
	registerCloudWorkspace(
		ticket.workspaceId,
		ticket,
		async () => ticket,
		rendererAccountSnapshot(),
	);
	state.environmentId = ticket.workspaceId;
	expect(renderToStaticMarkup(<Content />)).toBe("<div></div>");
	selectRendererWorkspace({ kind: "organization", organizationId: "org-a" });
	expect(renderToStaticMarkup(<Content />)).toContain("Secret chat");
	selectRendererWorkspace({ kind: "organization", organizationId: "org-b" });
	expect(renderToStaticMarkup(<Content />)).toBe("<div></div>");
});
