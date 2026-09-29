import type { ResolvedMcpServer } from "@zuse/agents/user-mcp/types";
import {
	ExecutorConnection,
	ExecutorIntegration,
	type ExecutorState,
	ExecutorToolkit,
} from "@zuse/contracts";
import { Schema } from "effect";

export const ExecutorProfile = Schema.Struct({
	url: Schema.String,
	token: Schema.String,
	enabled: Schema.Boolean,
	toolkit: Schema.NullOr(Schema.String),
});
export type ExecutorProfile = typeof ExecutorProfile.Type;
class ExecutorClientError extends Error {}

const MAX_BYTES = 2 * 1024 * 1024;
/** Only an explicitly configured service receives the user's credential. Never follow redirects. */
export function executorOrigin(input: string): string {
	const url = new URL(input);
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		(url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		(url.pathname !== "/" && url.pathname !== "")
	)
		throw new ExecutorClientError(
			"Use the Executor service URL: HTTPS, or HTTP on localhost. Do not include a path or credentials.",
		);
	return url.origin;
}
export function executorMcpServer(profile: ExecutorProfile): ResolvedMcpServer {
	const path =
		profile.toolkit === null
			? "/mcp"
			: `/mcp/toolkits/${encodeURIComponent(profile.toolkit)}`;
	return {
		name: "zuse_executor",
		transport: "http",
		url: `${executorOrigin(profile.url)}${path}`,
		headers: { Authorization: `Bearer ${profile.token}` },
	};
}
export const disconnectedExecutorState = (): ExecutorState => ({
	configured: false,
	url: null,
	enabled: false,
	toolkit: null,
	integrations: [],
	connections: [],
	toolkits: [],
	error: null,
});

async function readExecutorCatalog(
	profile: ExecutorProfile,
	signal?: AbortSignal,
	fetcher: typeof fetch = fetch,
): Promise<ExecutorState> {
	const read = async (path: string): Promise<unknown> => {
		const response = await fetcher(
			`${executorOrigin(profile.url)}/api/${path}`,
			{
				headers: {
					Authorization: `Bearer ${profile.token}`,
					Accept: "application/json",
				},
				redirect: "error",
				signal: signal
					? AbortSignal.any([signal, AbortSignal.timeout(15000)])
					: AbortSignal.timeout(15000),
			},
		);
		if (!response.ok) {
			await response.body?.cancel();
			throw new ExecutorClientError(
				response.status === 401 || response.status === 403
					? "Executor authentication failed. Reconnect with a personal API key."
					: `Executor request failed (${response.status}).`,
			);
		}
		const reader = response.body?.getReader();
		if (!reader)
			throw new ExecutorClientError("Executor returned an empty response.");
		let bytes = 0;
		const chunks: Uint8Array[] = [];
		try {
			while (true) {
				const next = await reader.read();
				if (next.done) break;
				bytes += next.value.byteLength;
				if (bytes > MAX_BYTES)
					throw new ExecutorClientError(
						"Executor catalog exceeds the download limit.",
					);
				chunks.push(next.value);
			}
		} finally {
			await reader.cancel();
			reader.releaseLock();
		}
		try {
			return JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			throw new ExecutorClientError("Executor returned an invalid catalog.");
		}
	};
	const [integrations, connections, toolkits] = await Promise.all([
		read("integrations"),
		read("connections"),
		read("toolkits"),
	]);
	try {
		return {
			configured: true,
			url: profile.url,
			enabled: profile.enabled,
			toolkit: profile.toolkit,
			error: null,
			integrations: Schema.decodeUnknownSync(Schema.Array(ExecutorIntegration))(
				integrations,
			),
			connections: Schema.decodeUnknownSync(Schema.Array(ExecutorConnection))(
				connections,
			),
			toolkits: Schema.decodeUnknownSync(
				Schema.Struct({ toolkits: Schema.Array(ExecutorToolkit) }),
			)(toolkits).toolkits,
		};
	} catch {
		throw new ExecutorClientError(
			"This Executor version returned an incompatible catalog. Update the service and retry.",
		);
	}
}

export async function executorCatalog(
	profile: ExecutorProfile,
	signal?: AbortSignal,
	fetcher: typeof fetch = fetch,
): Promise<ExecutorState> {
	try {
		return await readExecutorCatalog(profile, signal, fetcher);
	} catch (cause) {
		throw cause instanceof ExecutorClientError
			? cause
			: new Error("Could not reach Executor. Check the service and retry.");
	}
}
