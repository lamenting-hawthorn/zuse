import { describe, expect, it } from "vitest";
import { createRendererAccountState } from "../../src/lib/renderer-account.ts";

describe("renderer account boundary", () => {
	it("distinguishes unknown identity from signed out and ordinary token refresh", () => {
		const account = createRendererAccountState();
		const observed: unknown[] = [];
		const unsubscribe = account.subscribe(() => {
			observed.push(account.snapshot());
		});
		expect(account.snapshot()).toEqual({ subject: undefined, epoch: 0 });
		account.observe(null);
		account.observe("owner");
		const signedIn = account.snapshot();
		account.observe("owner");
		expect(account.snapshot()).toBe(signedIn);
		expect(observed).toEqual([
			{ subject: null, epoch: 1 },
			{ subject: "owner", epoch: 2 },
		]);
		unsubscribe();
		account.observe(null);
		expect(observed).toHaveLength(2);
	});

	it("fences old work even when a user returns to the original account", () => {
		const account = createRendererAccountState();
		account.observe("first");
		const original = account.snapshot();
		account.observe("second");
		account.observe("first");
		expect(account.snapshot().subject).toBe(original.subject);
		expect(account.snapshot()).not.toBe(original);
		expect(account.snapshot().epoch).toBeGreaterThan(original.epoch);
	});
});
