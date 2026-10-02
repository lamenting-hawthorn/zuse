import { describe, expect, test } from "vitest";
import { githubInstallationSettingsUrl } from "../../src/github-installation.ts";

describe("GitHub installation settings", () => {
	test("opens personal installations without an organization path", () => {
		expect(githubInstallationSettingsUrl(123)).toBe(
			"https://github.com/settings/installations/123",
		);
	});
	test("opens the owning organization's installation", () => {
		expect(
			githubInstallationSettingsUrl(123, {
				accountType: "Organization",
				accountLogin: "acme",
			}),
		).toBe("https://github.com/organizations/acme/settings/installations/123");
	});
	test("encodes account names as a single path segment", () => {
		expect(
			githubInstallationSettingsUrl(123, {
				accountType: "Organization",
				accountLogin: "acme/other",
			}),
		).toBe(
			"https://github.com/organizations/acme%2Fother/settings/installations/123",
		);
	});
});
