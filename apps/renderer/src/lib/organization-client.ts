import {
	ApiPaths,
	type MemoizeRpcs,
	Organization,
	OrganizationDetails,
	OrganizationError,
	OrganizationInvitation,
} from "@zuse/contracts";
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
		if (!response.ok)
			return yield* new OrganizationError({
				code:
					response.status === 401 || response.status === 403
						? "not-allowed"
						: response.status === 404
							? "not-found"
							: response.status === 409
								? "conflict"
								: response.status === 400 || response.status === 422
									? "invalid-request"
									: "unavailable",
			});
		const value = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: () => new OrganizationError({ code: "unavailable" }),
		});
		return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
			Effect.mapError(() => new OrganizationError({ code: "unavailable" })),
		);
	});

	const acknowledgement = Schema.Struct({ ok: Schema.Literal(true) });
	return {
		"organizations.list": () =>
			request(ApiPaths.organizations, Schema.Array(Organization)),
		"organizations.get": (input) =>
			request(ApiPaths.organizationDetails, OrganizationDetails, input),
		"organizations.create": (input) =>
			request(ApiPaths.organizations, Organization, input),
		"organizations.invite": (input) =>
			request(ApiPaths.organizationInvite, OrganizationInvitation, input),
		"organizations.revokeInvite": (input) =>
			request(ApiPaths.organizationRevokeInvite, acknowledgement, input).pipe(
				Effect.asVoid,
			),
		"organizations.setRole": (input) =>
			request(ApiPaths.organizationSetRole, acknowledgement, input).pipe(
				Effect.asVoid,
			),
		"organizations.removeMember": (input) =>
			request(ApiPaths.organizationRemoveMember, acknowledgement, input).pipe(
				Effect.asVoid,
			),
	};
};

/** Organization administration belongs to the user's account, not the selected host. */
export const runOrganizations = async <A>(
	run: (client: OrganizationClient) => Effect.Effect<A, unknown>,
): Promise<A> => {
	if (!isHostedProduct()) return runControlPlane(run);
	const account = rendererAccountSnapshot();
	try {
		return await Effect.runPromise(run(makeHostedClient(account)));
	} finally {
		assertRendererAccountCurrent(account);
	}
};
