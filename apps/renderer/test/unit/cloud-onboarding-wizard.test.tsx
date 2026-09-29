import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("../../src/components/settings/cloud-workspace-pool.tsx", () => ({
	CloudWorkspacePool: ({ onboarding }: { onboarding: { step: string } }) => (
		<div data-cloud-step={onboarding.step} />
	),
}));

import { CloudOnboardingWizard } from "../../src/components/onboarding/cloud-onboarding-wizard.tsx";

it("renders the first step as an app-wide wizard with guarded progression", () => {
	const markup = renderToStaticMarkup(
		<CloudOnboardingWizard
			onFinish={() => undefined}
			onDefer={() => undefined}
		/>,
	);
	expect(markup).toContain("1. Connect GitHub");
	expect(markup).toContain('data-cloud-step="github"');
	expect(markup).toContain('aria-current="step"');
	expect(markup).toContain("Finish later");
	const buttons = markup.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
	expect(buttons.find((button) => button.includes("Continue"))).toContain(
		"disabled",
	);
	expect(markup).not.toContain("Usage");
});
