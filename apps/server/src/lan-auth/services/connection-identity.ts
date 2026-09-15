import type { AuthTokenId } from "@zuse/contracts";
import { Context } from "effect";

/** Verified credential identity, not a workspace permission or client-supplied actor. */
export type CredentialIdentity =
	| {
			readonly kind: "paired";
			readonly tokenId: AuthTokenId;
			readonly deviceId: string | null;
	  }
	| {
			readonly kind: "account";
			readonly subject: string;
			readonly expiresAt: number;
	  };

/** Installed by the transport, never decoded from RPC metadata. */
export class ConnectionIdentity extends Context.Service<
	ConnectionIdentity,
	CredentialIdentity | { readonly kind: "local" }
>()("zuse/lan-auth/ConnectionIdentity") {}
