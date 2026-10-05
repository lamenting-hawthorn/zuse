import type { Organization } from "@zuse/contracts";
import { useUiStore } from "../store/ui.ts";
import { selectRendererWorkspace } from "./renderer-workspace.ts";

/** Switches to an organization's workspace; billing-only members land on Billing. */
export const openOrganizationWorkspace = (
	organization: Pick<Organization, "id" | "role">,
): void => {
	selectRendererWorkspace({
		kind: "organization",
		organizationId: organization.id,
	});
	if (organization.role !== "billing") return;
	useUiStore.getState().setSettingsSection({ kind: "cloud", page: "billing" });
	useUiStore.getState().setView("settings");
};
