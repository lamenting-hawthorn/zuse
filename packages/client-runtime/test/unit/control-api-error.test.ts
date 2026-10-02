import { expect, it } from "vitest";
import { cloudFailurePresentation } from "../../src/cloud-failure-presentation.ts";
import {
	cloudControlError,
	controlApiErrorCode,
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
