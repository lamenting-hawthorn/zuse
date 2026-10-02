import { expect, it } from "vitest";
import { canUseExperimentalHarness } from "../../src/feature-access.ts";

it.each([
	undefined,
	null,
	"",
	"someone@gmail.com",
	"mrfranklenstein+other@gmail.com",
	"mrfranklenstein@gmail.com.evil",
])("denies other identities: %s", (email) => {
	expect(canUseExperimentalHarness(email)).toBe(false);
});
it("allows only the rollout account, case-insensitively", () => {
	expect(canUseExperimentalHarness("mrfranklenstein@gmail.com")).toBe(true);
	expect(canUseExperimentalHarness(" MRFRANKLENSTEIN@GMAIL.COM ")).toBe(true);
});
