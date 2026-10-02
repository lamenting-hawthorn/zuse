import { EnvironmentId } from "@zuse/contracts";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useModelCatalogStore } from "~/store/model-catalog";
import { useProvidersStore } from "~/store/providers";
import { ModelConnectionController } from "./model-connections.ts";
import { runtimeOperationClient } from "./runtime-operation-client.ts";
import { openExternal } from "./use-provider-login.ts";

/** Mount this with an environment key so changing computers disposes the old attempt. */
export function useModelConnections(environmentId: string) {
	const [controller] = useState(
		() =>
			new ModelConnectionController(
				() => runtimeOperationClient(environmentId),
				openExternal,
			),
	);
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.snapshot,
		controller.snapshot,
	);
	useEffect(() => {
		controller.activate();
		void controller.load();
		return () => controller.dispose();
	}, [controller]);
	const identity = JSON.stringify(
		state.connections.map((c) => [c.id, c.authorized, c.status]),
	);
	useEffect(() => {
		void useProvidersStore
			.getState()
			.refreshFor(EnvironmentId.make(environmentId));
		void useModelCatalogStore
			.getState()
			.refreshFor(EnvironmentId.make(environmentId));
	}, [identity, environmentId]);
	return { state, controller };
}
