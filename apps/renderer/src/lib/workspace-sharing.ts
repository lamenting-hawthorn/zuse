import type { ChatRef } from "@zuse/client-runtime/resource-ref";
import { Effect } from "effect";
import type { MemoizeClient } from "./rpc-client.ts";
import { getRendererClientBus } from "./session-timeline-client-bus.ts";

/** Transient access settings use the environment's existing connected client. */
const run = <A>(
	ref: ChatRef,
	operation: (client: MemoizeClient) => Effect.Effect<A, unknown>,
): Promise<A> => {
	const client = getRendererClientBus().client(ref.environmentId);
	if (client === null)
		return Promise.reject(new Error("Environment is not connected"));
	return Effect.runPromise(operation(client));
};

export const workspaceSharing = {
	organizations: (ref: ChatRef) =>
		run(ref, (client) => client["organizations.list"]({})),
	get: (ref: ChatRef, organizationId: string) =>
		run(ref, (client) =>
			client["organizations.getWorkspaceSharing"]({
				organizationId,
				chatId: ref.chatId,
			}),
		),
	setShared: (ref: ChatRef, organizationId: string, shared: boolean) =>
		run(ref, (client) =>
			client["organizations.setWorkspaceSharing"]({
				organizationId,
				chatId: ref.chatId,
				shared,
			}),
		),
	setGrant: (
		ref: ChatRef,
		organizationId: string,
		userId: string,
		role: "driver" | "viewer" | null,
	) =>
		run(ref, (client) =>
			client["organizations.setWorkspaceGrant"]({
				organizationId,
				chatId: ref.chatId,
				userId,
				role,
			}),
		),
};

export type WorkspaceSharingState = Awaited<
	ReturnType<typeof workspaceSharing.get>
>;
