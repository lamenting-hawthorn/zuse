import { expect, it } from "vitest";
import { cloudFailurePresentation } from "../../src/cloud-failure-presentation.ts";
import {
	cloudControlError,
	controlApiErrorCode,
	organizationControlError,
} from "../../src/control-api-error.ts";

it("surfaces runtime incompatibility as an update requirement", () => {
	const error = cloudControlError(
		controlApiErrorCode(409, "workspace_runtime_update_required"),
	);
	expect(cloudFailurePresentation({ cause: error })?.kind).toBe(
		"update-required",
	);
});

it("preserves ordinary conflicts", () => {
	expect(controlApiErrorCode(409, "conflict")).toBe("conflict");
});

it("presents organization permission denials as access errors, not outages", () => {
	expect(
		organizationControlError(controlApiErrorCode(403, "forbidden")).code,
	).toBe("not-allowed");
});

it("does not mistake a permission denial for an expired login", () => {
	expect(
		cloudFailurePresentation({
			cause: cloudControlError(controlApiErrorCode(401, "unauthorized")),
		})?.kind,
	).toBe("sign-in-required");
	expect(
		cloudFailurePresentation({
			cause: cloudControlError(
				controlApiErrorCode(403, "workspace_access_denied"),
			),
		})?.kind,
	).toBe("cloud-access-required");
});
