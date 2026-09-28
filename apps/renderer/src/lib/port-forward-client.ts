import { getTunnelsBridge } from "./bridge.ts";
import { prepareCloudWorkspaceSsh } from "./cloud-ssh-client-bus.ts";
import {
	getLocalEnvironmentId,
	isCloudWorkspaceEnvironment,
} from "./rpc-client.ts";

export const cloudAccessForwardFailure = (cause: unknown): boolean => {
	const detail = cause instanceof Error ? cause.message : String(cause);
	return /(?:zuse ssh bridge:|permission denied|connection (?:unexpectedly )?(?:closed|reset|timed out)|kex_exchange_identification|no route to host|could not resolve hostname|tunnel timed out before it became ready)/iu.test(
		detail,
	);
};

/**
 * Ensure a dev server port on the given environment is reachable locally and
 * return the local port to open. Local environments need no forward; cloud
 * and SSH environments get an idempotent tunnel from the desktop main
 * process. Cloud forwards refresh the workspace SSH ticket first, so an
 * expired ticket never surfaces as a dead tunnel.
 */
export const ensurePortForward = async (
	environmentId: string,
	remotePort: number,
): Promise<number> => {
	if (environmentId === getLocalEnvironmentId()) return remotePort;
	const tunnels = getTunnelsBridge();
	if (tunnels === undefined) {
		throw new Error("Previewing remote servers requires the Zuse desktop app.");
	}
	const live = (await tunnels.list(environmentId)).find(
		(forward) => forward.remotePort === remotePort,
	);
	if (live !== undefined) return live.localPort;
	if (isCloudWorkspaceEnvironment(environmentId)) {
		await prepareCloudWorkspaceSsh(environmentId);
		try {
			const forward = await tunnels.open({
				environmentId,
				remotePort,
				cloudWorkspaceId: environmentId,
			});
			return forward.localPort;
		} catch (cause) {
			if (!cloudAccessForwardFailure(cause)) throw cause;
			// A bridge can fail after its ticket was prepared (for example when the
			// workspace paused between those operations). Refresh credentials once.
			await prepareCloudWorkspaceSsh(environmentId);
			const forward = await tunnels.open({
				environmentId,
				remotePort,
				cloudWorkspaceId: environmentId,
			});
			return forward.localPort;
		}
	}
	const forward = await tunnels.open({ environmentId, remotePort });
	return forward.localPort;
};

// Serialize control-panel operations so turning forwarding off also closes
// tunnels whose asynchronous SSH preparation was already in flight.
const previewForwardTasks = new Map<string, Promise<unknown>>();
const queuePreviewForward = <T>(
	environmentId: string,
	work: () => Promise<T>,
): Promise<T> => {
	const task = (previewForwardTasks.get(environmentId) ?? Promise.resolve())
		.catch(() => {})
		.then(work);
	previewForwardTasks.set(environmentId, task);
	void task
		.finally(() => {
			if (previewForwardTasks.get(environmentId) === task)
				previewForwardTasks.delete(environmentId);
		})
		.catch(() => {});
	return task;
};
export const ensurePreviewPortForward = (
	environmentId: string,
	port: number,
	enabled: () => boolean,
): Promise<number> =>
	queuePreviewForward(environmentId, () => {
		if (!enabled()) throw new Error("Port forwarding is disabled.");
		return ensurePortForward(environmentId, port);
	});
export const closePreviewPortForwards = (
	environmentId: string,
): Promise<void> =>
	queuePreviewForward(environmentId, async () => {
		const tunnels = getTunnelsBridge();
		if (!tunnels) return;
		for (const tunnel of await tunnels.list(environmentId))
			await tunnels.close(environmentId, tunnel.remotePort);
	});
