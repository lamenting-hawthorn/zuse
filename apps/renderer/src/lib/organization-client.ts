import {
	controlApiErrorCode,
	organizationControlError,
} from "@zuse/client-runtime/control-api-error";
import { makeOrganizationControlClient } from "@zuse/client-runtime/organization-control-client";
import { type MemoizeRpcs, OrganizationError } from "@zuse/contracts";
import { Effect, Schema } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { runControlPlane } from "./control-plane-client.ts";
import { isHostedProduct } from "./platform-capabilities.ts";
import {
	assertRendererAccountCurrent,
	type RendererAccountSnapshot,
	rendererAccountSnapshot,
} from "./renderer-account.ts";

type OrganizationRpc = Extract<
	RpcGroup.Rpcs<typeof MemoizeRpcs>,
	{
		readonly _tag:
			| "organizations.list"
			| "organizations.get"
			| "organizations.create"
			| "organizations.invite"
			| "organizations.revokeInvite"
			| "organizations.setRole"
			| "organizations.removeMember";
	}
>;
type OrganizationClient = {
	[Operation in OrganizationRpc as Operation["_tag"]]: (
		input: Rpc.PayloadConstructor<Operation>,
	) => Effect.Effect<Rpc.Success<Operation>, unknown>;
};

const makeHostedClient = (
	account: RendererAccountSnapshot,
): OrganizationClient => {
	const request = Effect.fn("Organizations.request")(function* <A, I>(
		path: string,
		schema: Schema.Codec<A, I>,
		body?: unknown,
	) {
		const response = yield* Effect.tryPromise({
			try: async () => {
				const { hostedAccountRequest } = await import("./hosted-connect.ts");
				assertRendererAccountCurrent(account);
				return hostedAccountRequest(path, body);
			},
			catch: () => new OrganizationError({ code: "unavailable" }),
		});
		if (!response.ok) {
			const payload = yield* Effect.promise(() =>
				response.json().catch(() => null),
			);
			const code = Schema.is(Schema.Struct({ error: Schema.String }))(payload)
				? payload.error
				: undefined;
			return yield* organizationControlError(
				controlApiErrorCode(response.status, code, path),
			);
		}
		const value = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: () => new OrganizationError({ code: "unavailable" }),
		});
		return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
			Effect.mapError(() => new OrganizationError({ code: "unavailable" })),
		);
	});

	return makeOrganizationControlClient(request);
};

/** Organization administration belongs to the user's account, not the selected host. */
export const runOrganizations = async <A>(
	run: (client: OrganizationClient) => Effect.Effect<A, unknown>,
): Promise<A> => {
	if (!isHostedProduct()) return runControlPlane(run, { scope: "account" });
	const account = rendererAccountSnapshot();
	try {
		return await Effect.runPromise(run(makeHostedClient(account)));
	} finally {
		assertRendererAccountCurrent(account);
	}
};
