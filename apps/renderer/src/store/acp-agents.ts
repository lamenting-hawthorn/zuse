import type {
	AcpCatalogEntry,
	AcpDefinition,
	AcpProviderId,
} from "@zuse/contracts";
import { Effect } from "effect";
import { toastManager } from "../components/ui/toast.tsx";
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
	/** Connection tests run per agent and do not lock the host. */
	testing: readonly AcpProviderId[];
	busy: string | null;
	error: string | null;
}
export const EMPTY_ACP_HOST: HostAgents = {
	definitions: [],
	catalog: [],
	catalogLoading: false,
	testing: [],
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
const hostState = (host: string) =>
	useAcpAgentsStore.getState().hosts[host] ?? EMPTY_ACP_HOST;

export const testAcpAgent = async (host: string, id: AcpProviderId) => {
	if (hostState(host).testing.includes(id)) return;
	update(host, { testing: [...hostState(host).testing, id], error: null });
	try {
		const client = await runtimeOperationClient(host);
		await Effect.runPromise(client["provider.acp.test"]({ id }));
		await loadAcpAgents(host);
		void refreshProviderMetadata(host);
	} catch (error) {
		update(host, { error: formatError(error) });
	} finally {
		update(host, {
			testing: hostState(host).testing.filter((item) => item !== id),
		});
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

export const ACP_SIGN_IN_LABEL = "Waiting for sign in…";
const signInOwners = new Map<string, StreamOperationOwner>();

/** Stops a pending sign-in; the server closes the agent process with the stream. */
export const cancelAcpSignIn = (host: string) => {
	signInOwners.get(host)?.cancel();
	signInOwners.delete(host);
	update(host, { terminal: undefined, authUrl: null, busy: null });
};

export const authenticateAcpAgent = async (
	host: string,
	id: AcpProviderId,
	methodId: string,
) => {
	if (useAcpAgentsStore.getState().hosts[host]?.busy) return;
	update(host, { busy: ACP_SIGN_IN_LABEL, error: null, authUrl: null });
	const owner = new StreamOperationOwner();
	signInOwners.set(host, owner);
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
				void refreshProviderMetadata(host);
				if (event.ok) {
					const name = hostState(host).definitions.find(
						(agent) => agent.id === id,
					)?.name;
					toastManager.add({
						type: "success",
						title: name ? `Signed in to ${name}` : "Signed in",
						description: "You can close the browser tab.",
					});
				}
			}
		},
		(error) => update(host, { error: formatError(error) }),
	);
	// A cancelled attempt already reset state; a newer attempt owns it now.
	if (signInOwners.get(host) !== owner) return;
	signInOwners.delete(host);
	update(host, { busy: null, terminal: undefined, authUrl: null });
};
