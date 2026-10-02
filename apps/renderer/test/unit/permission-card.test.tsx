import { EnvironmentId, PermissionRequest, SessionId } from "@zuse/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	PermissionCard,
	PermissionPrompt,
} from "../../src/components/permission-card.tsx";

const request = PermissionRequest.make({
	id: "approval-1",
	sessionId: SessionId.make("cloud-session"),
	kind: { _tag: "Bash", command: "git status" },
	requestedAt: new Date(0),
	forcePrompt: false,
});

describe("permission recovery presentation", () => {
	it("keeps chat-scoped choices without offering a folder-wide rule", () => {
		const html = renderToStaticMarkup(
			<PermissionPrompt
				requestId={request.id}
				kind={request.kind}
				queueSize={1}
				allowFolderRule={false}
				onDecision={async () => {}}
			/>,
		);
		expect(html).toContain("Allow once");
		expect(html).toContain("Allow for session");
		expect(html).not.toContain("Always allow");
	});
	it("keeps a live approval actionable regardless of its age", () => {
		const html = renderToStaticMarkup(
			<PermissionCard
				head={request}
				queueSize={1}
				environmentId={EnvironmentId.make("cloud-1")}
			/>,
		);
		expect(html).toContain("git status");
		expect(html).toContain("Allow once");
		expect(html).not.toContain("expired");
	});
	it("preserves an expired approval without offering unsafe approval actions", () => {
		const html = renderToStaticMarkup(
			<PermissionCard
				head={PermissionRequest.make({ ...request, recoveryState: "expired" })}
				queueSize={1}
				environmentId={EnvironmentId.make("cloud-1")}
			/>,
		);
		expect(html).toContain("git status");
		expect(html).toContain("Approval expired after agent restart");
		expect(html).toContain("Dismiss");
		expect(html).not.toContain("Allow once");
		expect(html).not.toContain("Always allow");
		expect(html).toContain('aria-live="polite"');
	});
});
