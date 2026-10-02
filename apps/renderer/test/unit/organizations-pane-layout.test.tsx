import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("../../src/hooks/use-auth.ts", () => ({
	useAuth: () => ({ isSignedIn: true, isLoading: false }),
}));

import { OrganizationsPane } from "../../src/components/settings/organizations-pane.tsx";

it("uses the settings width without a second organization selector in workspace settings", () => {
	const markup = renderToStaticMarkup(
		<OrganizationsPane organizationId="org-a" />,
	);
	expect(markup).not.toContain("Your organizations");
	expect(markup).not.toContain("max-w-xl");
	expect(markup).toContain("flex flex-col gap-4");
	expect(markup).toContain('role="status"');
	expect(markup).toContain("Refresh");
});

it("retains the organization picker for the unscoped management entry", () => {
	const markup = renderToStaticMarkup(<OrganizationsPane />);
	expect(markup).toContain("Your organizations");
	expect(markup).toContain("Refresh");
});
