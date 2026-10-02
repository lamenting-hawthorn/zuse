export type RendererPlatformCapabilities = {
	readonly desktop: boolean;
	readonly copyServerFile: boolean;
	readonly integratedBrowser: boolean;
	readonly nativeMenus: boolean;
	readonly networkLifecycle: boolean;
	readonly openInEditor: boolean;
	readonly revealInFileManager: boolean;
	readonly updater: boolean;
};

export const rendererPlatformCapabilities =
	(): RendererPlatformCapabilities => {
		const bridge = globalThis.window?.zuse ?? globalThis.window?.memoize;
		return {
			desktop: bridge !== undefined,
			copyServerFile: bridge?.app?.copyFileContents !== undefined,
			integratedBrowser: bridge?.browser !== undefined,
			nativeMenus: bridge?.menu !== undefined,
			networkLifecycle: bridge?.network !== undefined,
			openInEditor: bridge?.app?.openPathInApp !== undefined,
			revealInFileManager: bridge?.app?.revealPath !== undefined,
			updater: bridge?.updates !== undefined,
		};
	};

export const attachmentUrl = (id: string): string =>
	rendererPlatformCapabilities().desktop
		? `zuse://attachments/${encodeURIComponent(id)}`
		: `/assets/attachments/${encodeURIComponent(id)}`;

export const openExternal = async (url: string): Promise<void> => {
	const bridge = (globalThis.window?.zuse ?? globalThis.window?.memoize)?.app;
	if (bridge?.openExternal !== undefined) {
		await bridge.openExternal(url);
		return;
	}
	window.open(url, "_blank", "noopener,noreferrer");
};

const copyTextWithSelection = (text: string): boolean => {
	if (globalThis.document?.body === undefined) return false;
	const input = document.createElement("textarea");
	input.value = text;
	input.setAttribute("readonly", "");
	input.style.position = "fixed";
	input.style.opacity = "0";
	document.body.append(input);
	input.select();
	input.setSelectionRange(0, text.length);
	const copied = document.execCommand("copy");
	input.remove();
	return copied;
};

export const copyText = async (text: string): Promise<void> => {
	const bridge = (globalThis.window?.zuse ?? globalThis.window?.memoize)?.app;
	if (bridge?.copyText !== undefined) {
		await bridge.copyText(text);
		return;
	}
	// Older desktop preloads do not expose copyText yet. Keep copy usable until
	// the next app restart swaps in the new preload instead of misusing copyPath,
	// which deliberately accepts existing filesystem paths only.
	if (bridge !== undefined && copyTextWithSelection(text)) return;
	if (navigator.clipboard?.writeText === undefined) {
		if (copyTextWithSelection(text)) return;
		throw new Error("Clipboard access is unavailable");
	}
	try {
		await navigator.clipboard.writeText(text);
	} catch (cause) {
		if (!copyTextWithSelection(text)) throw cause;
	}
};
