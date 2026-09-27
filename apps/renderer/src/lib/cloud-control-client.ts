import type { CloudControlClient } from "@zuse/client-runtime/cloud-control-client";
import { CloudWorkspaceOpError, type WorkspaceScope } from "@zuse/contracts";
import { Effect, Option, Schema } from "effect";
import { isHostedProduct } from "./platform-capabilities.ts";
import {
	assertRendererAccountCurrent,
	rendererAccountSnapshot,
} from "./renderer-account.ts";
import { rendererWorkspaceSnapshot } from "./renderer-workspace.ts";
import { getControlPlaneRpcClient, type MemoizeClient } from "./rpc-client.ts";

const decodeApiFailure = Schema.decodeUnknownOption(
	Schema.Struct({
		error: Schema.optional(Schema.String),
		code: Schema.optional(Schema.String),
	}),
);

/** Cloud ownership/control uses account HTTP on web, the existing desktop RPC otherwise. */
export const getCloudControlClient = async (
	scope: WorkspaceScope = rendererWorkspaceSnapshot().scope,
): Promise<
	CloudControlClient | Pick<MemoizeClient, keyof CloudControlClient>
> => {
	if (!isHostedProduct()) return getControlPlaneRpcClient(scope);
	const account = rendererAccountSnapshot();
	const [
		{ hostedAccountRequest },
		{ makeCloudControlClient },
		{ cloudControlError, controlApiErrorCode },
	] = await Promise.all([
		import("./hosted-connect.ts"),
		import("@zuse/client-runtime/cloud-control-client"),
		import("@zuse/client-runtime/control-api-error"),
	]);
	assertRendererAccountCurrent(account);
	const requestError = () =>
		new CloudWorkspaceOpError({
			code:
				rendererAccountSnapshot() === account
					? "provider-unavailable"
					: "not-allowed",
		});
	return makeCloudControlClient((path, schema, method, body) =>
		Effect.gen(function* () {
			const response = yield* Effect.tryPromise({
				try: (signal) => {
					assertRendererAccountCurrent(account);
					return hostedAccountRequest(path, body, {
						method,
						workspace: scope,
						signal,
					});
				},
				catch: requestError,
			});
			if (!response.ok) {
				const payload = yield* Effect.tryPromise({
					try: async () => {
						const payload: unknown = await response.json().catch(() => null);
						assertRendererAccountCurrent(account);
						return payload;
					},
					catch: requestError,
				});
				const failure = Option.getOrUndefined(decodeApiFailure(payload));
				const code = failure?.error ?? failure?.code;
				return yield* Effect.fail(
					cloudControlError(controlApiErrorCode(response.status, code, path)),
				);
			}
			const payload = yield* Effect.tryPromise({
				try: async () => {
					const payload: unknown = await response.json();
					assertRendererAccountCurrent(account);
					return payload;
				},
				catch: requestError,
			});
			return yield* Schema.decodeUnknownEffect(schema)(payload).pipe(
				Effect.mapError(
					() => new CloudWorkspaceOpError({ code: "invalid-request" }),
				),
			);
		}),
	);
};
