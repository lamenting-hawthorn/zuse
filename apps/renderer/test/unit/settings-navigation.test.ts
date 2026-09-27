import { describe, expect, it } from "vitest";
import { settingsNavigationFor } from "../../src/lib/settings-navigation.ts";

describe("settings contexts", () => {
	it("exposes sharing defaults only in the selected organization's settings", () => {
		const organization = settingsNavigationFor(
			{ kind: "organizations" },
			true,
			{ kind: "organization", organizationId: "org_a" },
		);
		expect(organization.find((item) => item.id === "sharing")?.section).toEqual(
			{ kind: "cloud", page: "sharing" },
		);
		expect(
			settingsNavigationFor({ kind: "general" }, true, {
				kind: "personal",
			}).some((item) => item.id === "sharing"),
		).toBe(false);
	});
	for (const desktop of [true, false]) {
		it(`keeps organization management separate (${desktop ? "desktop" : "web"})`, () => {
			expect(
				settingsNavigationFor({ kind: "organizations" }, desktop).map(
					(item) => item.id,
				),
			).toEqual(["organizations"]);
			const personal = settingsNavigationFor({ kind: "general" }, desktop).map(
				(item) => item.id,
			);
			expect(personal).toContain("general");
			expect(personal).not.toContain("organizations");
			if (!desktop) {
				expect(personal).not.toContain("self-hosted");
				expect(personal).not.toContain("machines");
			}
		});
	}
});
