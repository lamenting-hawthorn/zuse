import { WORKSPACE_SCOPE_HEADER, type WorkspaceScope } from "@zuse/contracts";
import { Effect, Stream } from "effect";
import { Headers } from "effect/unstable/http";
import { RpcClient } from "effect/unstable/rpc";
import { workspaceScopeKey } from "./renderer-workspace.ts";

/** Bind ownership once, including lazy subscriptions, without another transport. */
export const withWorkspaceScope = <Client extends object>(
	client: Client,
	scope: WorkspaceScope,
): Client => {
	const headers = Headers.fromInput({
		[WORKSPACE_SCOPE_HEADER]: workspaceScopeKey(scope),
	});
	const wrappers = new Map<PropertyKey, unknown>();
	return new Proxy(client, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver);
			if (typeof value !== "function") return value;
			if (wrappers.has(property)) return wrappers.get(property);
			const wrapped = (...args: ReadonlyArray<unknown>) => {
				const result: unknown = Reflect.apply(value, target, args);
				if (Effect.isEffect(result))
					return result.pipe(RpcClient.withHeaders(headers));
				if (Stream.isStream(result))
					return result.pipe(
						Stream.provideService(RpcClient.CurrentHeaders, headers),
					);
				return result;
			};
			wrappers.set(property, wrapped);
			return wrapped;
		},
	});
};
