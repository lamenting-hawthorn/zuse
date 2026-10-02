import { describe, expect, test } from "vitest";
import { renderIntegrationPage } from "../../src/integration-page.ts";

describe("integration page", () => {
	test("keeps account selection usable without scripts or external assets", () => {
		const page = renderIntegrationPage({
			integration: "GitHub",
			title: "Choose a GitHub account",
			description: "For your QA workspace.",
			status: "Connect",
			hint: "Choose repositories on GitHub, then return to connect.",
			actions: [
				{
					label: "Use this account",
					accountName: 'test<owner>"',
					description: "Personal GitHub account",
					manageUrl: "https://github.com/settings/installations/123",
					action: "/callback",
					csrf: 'token"<>&',
				},
			],
		});
		expect(page).toContain('class="dither" aria-hidden="true"');
		expect(page).toContain('preserveAspectRatio="xMidYMid slice"');
		expect(page).toContain('method="post" action="/callback"');
		expect(page).toContain('name="csrf" value="token&quot;&lt;&gt;&amp;"');
		expect(page).toContain("Use this account: test&lt;owner&gt;&quot;");
		expect(page).toContain('rel="noopener noreferrer"');
		expect(page).not.toMatch(/<script|<img|<iframe|animation:/u);
		expect(page).not.toContain("test<owner>");
		expect(page.length).toBeLessThan(65_000);
	});
});
