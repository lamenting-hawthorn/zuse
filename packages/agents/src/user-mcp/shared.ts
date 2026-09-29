import { makeStdioMcpFallback } from "../kernel/stdio-mcp-fallback.ts";
import type { ResolvedMcpServer } from "./types.ts";

/** Shared HTTP tools can also reach ACP agents that only implement stdio MCP. */
export async function sharedAcpMcpServers(
	servers: ReadonlyArray<ResolvedMcpServer>,
	http: boolean,
) {
	return Promise.all(
		servers.map(async (server) => {
			if (server.transport !== "http" || !server.url)
				throw new Error("Shared plugins require an HTTP MCP connection.");
			if (http)
				return {
					type: "http" as const,
					name: server.name,
					url: server.url,
					headers: Object.entries(server.headers ?? {}).map(
						([name, value]) => ({ name, value }),
					),
				};
			const authorization = server.headers?.Authorization;
			if (
				!authorization?.startsWith("Bearer ") ||
				Object.keys(server.headers ?? {}).length !== 1
			)
				throw new Error("Cannot bridge shared plugin authentication to stdio.");
			const [config] = await makeStdioMcpFallback({
				command: process.execPath,
				endpoint: server.url,
				token: authorization.slice(7),
			}).ensure();
			if (!config)
				throw new Error("Could not create the shared plugin bridge.");
			return { ...config, name: server.name };
		}),
	);
}

/** Codex config references environment variables, never puts credentials in argv. */
export function sharedCodexMcpConfig(
	servers: ReadonlyArray<ResolvedMcpServer>,
) {
	const args: string[] = [];
	const env: Record<string, string> = {};
	for (const [index, server] of servers.entries()) {
		if (server.transport !== "http" || !server.url)
			throw new Error("Shared plugins require an HTTP MCP connection.");
		const prefix = `mcp_servers.${JSON.stringify(server.name)}`;
		args.push("-c", `${prefix}.url=${JSON.stringify(server.url)}`);
		for (const [headerIndex, [name, value]] of Object.entries(
			server.headers ?? {},
		).entries()) {
			const variable = `ZUSE_SHARED_MCP_${index}_${headerIndex}`;
			env[variable] = value;
			args.push(
				"-c",
				`${prefix}.env_http_headers.${JSON.stringify(name)}=${JSON.stringify(variable)}`,
			);
		}
	}
	return { args, env };
}
