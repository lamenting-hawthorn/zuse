import { EnvironmentId } from "@zuse/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const scopedResources = vi.hoisted(() => ({
	shell: vi.fn(() => ({ data: null })),
	permissions: vi.fn(() => ({ data: null })),
}));
vi.mock("../../src/lib/environment-shell-client-bus.ts", () => ({
	useEnvironmentShellResource: scopedResources.shell,
}));
vi.mock("../../src/lib/environment-permissions-client-bus.ts", () => ({
	useEnvironmentPermissions: scopedResources.permissions,
}));

import { ChatTabButton, MainTabs } from "../../src/components/main-tabs.tsx";

it("reads tabs and approval state from the displayed cloud environment", () => {
	const environmentId = EnvironmentId.make("workspace-cloud");
	renderToStaticMarkup(
		<MainTabs
			environmentId={environmentId}
			projectId={null}
			emptyLabel="Cloud conversation"
		/>,
	);
	expect(scopedResources.shell).toHaveBeenCalledWith(environmentId);
	expect(scopedResources.permissions).toHaveBeenCalledWith(environmentId);
});

describe("ChatTabButton", () => {
	it.each([
		false,
		true,
	])("keeps the title and gates mutation actions (read-only: %s)", (readOnly) => {
		const markup = renderToStaticMarkup(
			<ChatTabButton
				readOnly={readOnly}
				active
				label="Stable Session Title"
				providerId="codex"
				booting
				running={false}
				activityState="working"
				awaitingPermission={false}
				awaitingPlanApproval={false}
				onClick={vi.fn()}
				onClose={vi.fn()}
				onRename={vi.fn()}
			/>,
		);

		expect(markup).toContain("Stable Session Title");
		expect(markup).not.toContain('class="truncate">Starting agent');
		expect(markup.match(/<button\b/g)).toHaveLength(readOnly ? 1 : 3);
	});
});
