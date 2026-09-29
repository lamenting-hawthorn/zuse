import { useEffect } from "react";
import { useExtensionCatalog } from "./extension-client-bus.ts";
import { ExtensionRegistry } from "./extension-registrations.ts";
import { extensionRegistry } from "./extension-registry.tsx";

const registrations = new ExtensionRegistry(extensionRegistry);

/** Load catalog transport after the application shell, keeping theme readers lightweight. */
export function ExtensionHostController() {
	const { items, globallyEnabled } = useExtensionCatalog();
	useEffect(
		() => registrations.sync({ items, globallyEnabled }),
		[items, globallyEnabled],
	);
	return null;
}
