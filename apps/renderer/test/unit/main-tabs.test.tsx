import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatTabButton } from "../../src/components/main-tabs.tsx";

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
