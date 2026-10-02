import { CloudWorkspaceOpError, type MachineErrorCode } from "@zuse/contracts";
import { Effect, Schema } from "effect";
import type { CloudControlRequest } from "./cloud-control-client.ts";
import { cloudControlError, controlApiErrorCode } from "./control-api-error.ts";

export type AccountControlRequest<E> = <A>(
	path: string,
	schema: Schema.Codec<A, unknown>,
	method?: string,
	body?: unknown,
) => Effect.Effect<A, E>;

/** One response decoder and account fence for hosted and native account HTTP. */
export const makeAccountControlRequest =
	<E>(options: {
		readonly send: (
			path: string,
			method: string,
			body: unknown,
			signal: AbortSignal,
		) => Promise<Response>;
		readonly toError: (code: MachineErrorCode) => E;
		readonly isCurrent: () => boolean;
	}): AccountControlRequest<E> =>
	(path, schema, method = "GET", body) =>
		Effect.gen(function* () {
			if (!options.isCurrent())
				return yield* Effect.fail(options.toError("not-allowed"));
			const response = yield* Effect.tryPromise({
				try: (signal) => options.send(path, method, body, signal),
				catch: () =>
					options.toError(
						options.isCurrent() ? "provider-unavailable" : "not-allowed",
					),
			});
			if (!options.isCurrent())
				return yield* Effect.fail(options.toError("not-allowed"));
			const payload: unknown = yield* Effect.tryPromise({
				try: () =>
					response.json().catch((cause) => {
						if (response.ok) throw cause;
						return null;
					}),
				catch: () =>
					options.toError(
						options.isCurrent() ? "provider-unavailable" : "not-allowed",
					),
			});
			if (!options.isCurrent())
				return yield* Effect.fail(options.toError("not-allowed"));
			if (!response.ok) {
				const code =
					typeof payload === "object" && payload !== null
						? (Reflect.get(payload, "error") ?? Reflect.get(payload, "code"))
						: undefined;
				return yield* Effect.fail(
					options.toError(controlApiErrorCode(response.status, code, path)),
				);
			}
			return yield* Schema.decodeUnknownEffect(schema)(payload).pipe(
				Effect.mapError(() => options.toError("invalid-request")),
			);
		});

export const makeCloudControlRequest =
	(options: {
		token: () => Promise<string | null>;
		url: (path: string) => string;
		epoch?: () => unknown;
	}): CloudControlRequest =>
	(path, schema, method, body) =>
		Effect.gen(function* () {
			const epoch = options.epoch?.();
			const token = yield* Effect.tryPromise({
				try: options.token,
				catch: () => new CloudWorkspaceOpError({ code: "not-allowed" }),
			});
			if (token === null)
				return yield* Effect.fail(
					new CloudWorkspaceOpError({ code: "not-allowed" }),
				);
			return yield* makeAccountControlRequest({
				isCurrent: () => epoch === options.epoch?.(),
				toError: cloudControlError,
				send: (path, method, body, signal) =>
					fetch(options.url(path), {
						method,
						signal,
						headers: {
							authorization: `Bearer ${token}`,
							...(body === undefined
								? {}
								: { "content-type": "application/json" }),
						},
						body: body === undefined ? undefined : JSON.stringify(body),
					}),
			})(path, schema, method, body);
		});
