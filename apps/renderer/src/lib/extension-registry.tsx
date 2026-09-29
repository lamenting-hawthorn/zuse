import type { ExtensionId } from "@zuse/contracts";
import type { ExtensionRegistrationCollector } from "@zuse/extension-sdk/host";
import { useSyncExternalStore } from "react";

export interface RegisteredExtension {
	readonly extensionId: ExtensionId;
	readonly contributions: ExtensionRegistrationCollector;
	readonly error: string | null;
}

export interface ActiveRegistration extends RegisteredExtension {
	readonly bundle: string;
	readonly dispose: () => Promise<void>;
}

export function createExtensionRegistryStore() {
	let snapshot: ReadonlyArray<RegisteredExtension> = [];
	const listeners = new Set<() => void>();
	return {
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSnapshot: () => snapshot,
		publish(next: ReadonlyArray<RegisteredExtension>) {
			snapshot = next;
			for (const listener of listeners) listener();
		},
	};
}

export const extensionRegistry = createExtensionRegistryStore();

const EMPTY_EXTENSION_CONTRIBUTIONS: ReadonlyArray<RegisteredExtension> = [];

export const useExtensionContributions =
	(): ReadonlyArray<RegisteredExtension> =>
		useSyncExternalStore(
			extensionRegistry.subscribe,
			extensionRegistry.getSnapshot,
			() => EMPTY_EXTENSION_CONTRIBUTIONS,
		);

export const extensionHostTheme = {
	colors: {
		background: "var(--background)",
		foreground: "var(--foreground)",
		card: "var(--card)",
		cardForeground: "var(--card-foreground)",
		popover: "var(--popover)",
		popoverForeground: "var(--popover-foreground)",
		muted: "var(--muted)",
		mutedForeground: "var(--muted-foreground)",
		border: "var(--border)",
		input: "var(--input)",
		accent: "var(--accent)",
		accentForeground: "var(--accent-foreground)",
		destructive: "var(--destructive)",
		ring: "var(--ring)",
	},
} as const;
