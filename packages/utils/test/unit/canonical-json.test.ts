import { expect, it } from "vitest";
import { canonicalJson } from "../../src/canonical-json.ts";

it("renders deterministic definitions and omits undefined fields", () => {
	expect(canonicalJson({ z: 1, a: { b: 2, missing: undefined } })).toBe(
		'{"a":{"b":2},"z":1}',
	);
	expect(canonicalJson({ a: { b: 2 }, z: 1 })).toBe(
		canonicalJson({ z: 1, a: { b: 2 } }),
	);
});
it("preserves existing v1 chat creation fingerprints", () => {
	expect(
		canonicalJson(
			{ z: 1, model: undefined, a: [undefined, 2] },
			{ legacyFingerprintV1: true },
		),
	).toBe('{"a":[,2],"model":undefined,"z":1}');
});
