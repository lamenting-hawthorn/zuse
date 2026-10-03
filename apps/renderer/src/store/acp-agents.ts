import type { AcpCatalogEntry, AcpDefinition } from "@zuse/contracts";
import { Effect } from "effect";
import { formatError } from "../lib/format-error.ts";
import { refreshProviderMetadata } from "../lib/refresh-provider-metadata.ts";
import type { MemoizeClient } from "../lib/rpc-client.ts";
import { runtimeOperationClient } from "../lib/runtime-operation-client.ts";
import { StreamOperationOwner } from "../lib/stream-operation.ts";
import { createAtomStore } from "../state/atom-store.ts";

interface HostAgents {
	authUrl?: string | null;
	terminal?: Extract<
		typeof import("@zuse/contracts").AcpAuthenticationEvent.Type,
		{ _tag: "terminal" }
	>;
	definitions: readonly AcpDefinition[];
	catalog: readonly AcpCatalogEntry[];
	catalogLoading: boolean;
	busy: string | null;
	error: string | null;
}
export const EMPTY_ACP_HOST: HostAgents = {
	definitions: [],
	catalog: [],
	catalogLoading: false,
	busy: null,
	error: null,
};
export const useAcpAgentsStore = createAtomStore<{
	hosts: Record<string, HostAgents>;
}>(() => ({ hosts: {} }));
const update = (host: string, patch: Partial<HostAgents>) =>
	useAcpAgentsStore.setState((state) => ({
		hosts: {
			...state.hosts,
			[host]: { ...(state.hosts[host] ?? EMPTY_ACP_HOST), ...patch },
		},
	}));
export const loadAcpAgents = async (host: string) => {
	try {
		const client = await runtimeOperationClient(host);
		const definitions = await Effect.runPromise(client["provider.acp.list"]());
		update(host, { definitions });
	} catch (error) {
		update(host, { error: formatError(error) });
	}
};
/** Operations belong to the host store, not the settings component's lifetime. */
export const runAcpOperation = async <A>(
	host: string,
	label: string,
	operation: (client: MemoizeClient) => Effect.Effect<A, unknown>,
) => {
	if (useAcpAgentsStore.getState().hosts[host]?.busy) return;
	update(host, { busy: label, error: null });
	try {
		const client = await runtimeOperationClient(host);
		const result = await Effect.runPromise(operation(client));
		await loadAcpAgents(host);
		// Pickers catch up in the background; settings stay usable meanwhile.
		void refreshProviderMetadata(host);
		return result;
	} catch (error) {
		update(host, { error: formatError(error) });
	} finally {
		update(host, { busy: null });
	}
};
/** Read-only, so it does not take the host's operation lock. */
export const loadAcpCatalog = async (host: string) => {
	if (useAcpAgentsStore.getState().hosts[host]?.catalogLoading) return;
	update(host, { catalogLoading: true, error: null });
	try {
		const client = await runtimeOperationClient(host);
		const catalog = await Effect.runPromise(client["provider.acp.catalog"]());
		update(host, { catalog });
	} catch (error) {
		update(host, { error: formatError(error) });
	} finally {
		update(host, { catalogLoading: false });
	}
};

export const authenticateAcpAgent = async (
	host: string,
	id: import("@zuse/contracts").AcpProviderId,
	methodId: string,
) => {
	if (useAcpAgentsStore.getState().hosts[host]?.busy) return;
	update(host, { busy: "Waiting for sign in…", error: null, authUrl: null });
	const owner = new StreamOperationOwner();
	await owner.run(
		async () =>
			(await runtimeOperationClient(host))["provider.acp.authenticate"]({
				id,
				methodId,
			}),
		async (event) => {
			if (event._tag === "url") update(host, { authUrl: event.url });
			if (event._tag === "terminal") update(host, { terminal: event });
			if (event._tag === "done") {
				update(host, { terminal: undefined, authUrl: null });
				if (!event.ok)
					update(host, { error: event.reason ?? "Sign in failed" });
				await loadAcpAgents(host);
				await refreshProviderMetadata(host);
			}
		},
		(error) => update(host, { error: formatError(error) }),
	);
	update(host, { busy: null });
};
