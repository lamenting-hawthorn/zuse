import { createHash, randomBytes } from "node:crypto";

const base64url = (buf: Buffer): string => buf.toString("base64url");

/** RFC 7636 PKCE pair + an anti-CSRF `state` nonce. */
export interface PkcePair {
	readonly verifier: string;
	readonly challenge: string;
	readonly state: string;
}

export const makePkce = (): PkcePair => {
	const verifier = base64url(randomBytes(32));
	const challenge = base64url(createHash("sha256").update(verifier).digest());
	const state = base64url(randomBytes(16));
	return { verifier, challenge, state };
};
