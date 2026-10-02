import { describe, expect, it } from "vitest";
import { createRendererWorkspaceState } from "../../src/lib/renderer-workspace.ts";

describe("workspace selection", () => {
	it("keeps scopes distinct and fences an A to B to A transition", () => {
		const state = createRendererWorkspaceState();
		const personal = state.snapshot();
		state.select({ kind: "organization", organizationId: "org_a" });
		const a = state.snapshot();
		state.select({ kind: "organization", organizationId: "org_b" });
		expect(state.snapshot().key).toBe("organization:org_b");
		state.select({ kind: "organization", organizationId: "org_a" });
		expect(state.snapshot().key).toBe(a.key);
		expect(state.snapshot()).not.toBe(a);
		state.reset();
		expect(state.snapshot().key).toBe("personal");
		expect(state.snapshot()).not.toBe(personal);
	});
	it("does not invalidate same-workspace requests on a repeated selection", () => {
		const state = createRendererWorkspaceState();
		const previous = state.snapshot();
		state.select({ kind: "personal" });
		expect(state.snapshot()).toBe(previous);
	});
	it("rejects invalid scope without changing the active workspace", () => {
		const state = createRendererWorkspaceState();
		const previous = state.snapshot();
		expect(() =>
			state.select({ kind: "organization", organizationId: "" }),
		).toThrow();
		expect(state.snapshot()).toBe(previous);
	});
});
