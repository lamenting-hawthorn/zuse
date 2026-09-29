/** Display-only work sleeps while hidden and refreshes once on return. */
export function startVisibleInterval(
	callback: () => void,
	intervalMs: number,
): () => void {
	let timer: number | null = null;
	const stop = () => {
		if (timer !== null) window.clearInterval(timer);
		timer = null;
	};
	const sync = () => {
		stop();
		if (document.visibilityState !== "visible") return;
		callback();
		timer = window.setInterval(callback, intervalMs);
	};
	document.addEventListener("visibilitychange", sync);
	sync();
	return () => {
		stop();
		document.removeEventListener("visibilitychange", sync);
	};
}
