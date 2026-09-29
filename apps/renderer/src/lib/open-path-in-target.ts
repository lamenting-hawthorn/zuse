import { getAppBridge } from "./bridge.ts";

/** Shared native folder opener for workspace and synced-folder menus. */
export async function openPathInTarget(
	path: string,
	targetId: string,
): Promise<void> {
	const bridge = getAppBridge();
	if (targetId === "finder") {
		await bridge?.revealPath?.(path);
	} else {
		await bridge?.openPathInApp?.(path, targetId);
	}
}
