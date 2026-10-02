import {
	type ClientCommand,
	type ClientCommandOwner,
	CommandAuthorityLostError,
} from "@zuse/client-runtime/client-persistence";
import type { EnvironmentId } from "@zuse/contracts";
import {
	type RendererAccountSnapshot,
	rendererAccountSnapshot,
	subscribeRendererAccount,
} from "./renderer-account.ts";

export const createRendererCommandAuthority = (
	resolve: (
		environmentId: EnvironmentId,
	) => "device" | RendererAccountSnapshot | undefined,
) => ({
	subscribeCommandAuthority: subscribeRendererAccount,
	commandOwnerFor(command: ClientCommand): ClientCommandOwner {
		const authority = resolve(command.environmentId);
		if (authority === "device") return { kind: "device" };
		if (
			authority === undefined ||
			authority !== rendererAccountSnapshot() ||
			typeof authority.subject !== "string"
		)
			throw new CommandAuthorityLostError();
		return { kind: "account", subject: authority.subject };
	},
	commandScopeFor(command: ClientCommand): () => boolean {
		const authority = resolve(command.environmentId);
		if (authority === "device")
			return () =>
				resolve(command.environmentId) === "device" &&
				(command.owner === undefined || command.owner.kind === "device");
		return () =>
			authority !== undefined &&
			authority === rendererAccountSnapshot() &&
			resolve(command.environmentId) === authority &&
			command.owner?.kind === "account" &&
			command.owner.subject === authority.subject;
	},
});
