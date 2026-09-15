import { Schema } from "effect";
import { RpcMiddleware } from "effect/unstable/rpc";

export class RpcAccessDeniedError extends Schema.TaggedErrorClass<RpcAccessDeniedError>()(
	"RpcAccessDeniedError",
	{ code: Schema.Literals(["access-denied", "credential-expired"]) },
) {}

/** Every RPC is subject to server-owned connection and workspace authorization. */
export class RpcAuthorization extends RpcMiddleware.Service<RpcAuthorization>()(
	"zuse/RpcAuthorization",
	{ error: RpcAccessDeniedError },
) {}
