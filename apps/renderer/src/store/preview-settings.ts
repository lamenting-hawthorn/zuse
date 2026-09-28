import { DEFAULT_LOCAL_DESKTOP_PORT } from "@zuse/contracts";
import { createAtomStore } from "../state/atom-store.ts";

export interface PreviewSettings {
	readonly publish: boolean;
	readonly forward: boolean;
	readonly ports: readonly number[];
}
export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
	publish: false,
	forward: false,
	ports: [],
};

const STORAGE_KEY = "zuse.preview-settings.v1";
export const isPreviewPort = (port: unknown): port is number =>
	typeof port === "number" &&
	Number.isInteger(port) &&
	port >= 1024 &&
	port <= 65535 &&
	port !== DEFAULT_LOCAL_DESKTOP_PORT;
const readSettings = (): Readonly<Record<string, PreviewSettings>> => {
	try {
		const value: unknown = JSON.parse(
			localStorage.getItem(STORAGE_KEY) ?? "{}",
		);
		if (typeof value !== "object" || value === null || Array.isArray(value))
			return {};
		return Object.fromEntries(
			Object.entries(value).flatMap(([id, entry]) => {
				if (
					typeof entry !== "object" ||
					entry === null ||
					typeof entry.publish !== "boolean" ||
					typeof entry.forward !== "boolean" ||
					!Array.isArray(entry.ports)
				)
					return [];
				return [
					[
						id,
						{
							publish: entry.publish,
							forward: entry.forward,
							ports: [...new Set<number>(entry.ports.filter(isPreviewPort))],
						},
					],
				];
			}),
		);
	} catch {
		return {};
	}
};
/** Explicit per-workspace opt-in survives renderer restarts and reconnects. */
export const usePreviewSettings = createAtomStore<{
	readonly environments: Readonly<Record<string, PreviewSettings>>;
	update: (environmentId: string, patch: Partial<PreviewSettings>) => void;
}>((set, get) => ({
	environments: readSettings(),
	update: (environmentId, patch) => {
		const environments = {
			...get().environments,
			[environmentId]: {
				...(get().environments[environmentId] ?? DEFAULT_PREVIEW_SETTINGS),
				...patch,
			},
		};
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(environments));
		} catch (cause) {
			console.warn("[preview-settings] Could not save preferences", cause);
		}
		set({ environments });
	},
}));
