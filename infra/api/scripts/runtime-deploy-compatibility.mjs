import { createPublicKey, verify } from "node:crypto";

/** Fail before deploying an API that its published runtime cannot enroll with. */
export function assertRuntimeCompatibility(signed, publicJwk, protocol) {
	const { signature, ...manifest } = signed;
	if (
		typeof signature !== "string" ||
		!verify(
			null,
			Buffer.from(JSON.stringify(manifest)),
			createPublicKey({ key: JSON.parse(publicJwk), format: "jwk" }),
			Buffer.from(signature, "base64url"),
		)
	) {
		throw new Error("Production runtime manifest signature is invalid.");
	}
	const range = manifest.wireProtocol;
	if (
		!Number.isInteger(range?.min) ||
		!Number.isInteger(range?.max) ||
		range.min > protocol ||
		range.max < protocol
	) {
		throw new Error(
			`Production runtime does not support API protocol ${protocol} (published range ${range?.min}–${range?.max}). Publish a compatible signed production runtime before deploying the API.`,
		);
	}
}
