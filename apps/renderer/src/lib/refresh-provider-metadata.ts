import { EnvironmentId } from "@zuse/contracts";
import { useModelCatalogStore } from "../store/model-catalog.ts";
import { useProvidersStore } from "../store/providers.ts";
export async function refreshProviderMetadata(environmentId: string) {
	await Promise.allSettled([
		useProvidersStore.getState().refreshFor(EnvironmentId.make(environmentId)),
		useModelCatalogStore
			.getState()
			.refreshFor(EnvironmentId.make(environmentId)),
	]);
}
