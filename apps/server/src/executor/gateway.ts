import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { ResolvedMcpServer } from "@zuse/agents/user-mcp/types";
import { type ExecutorProfile, executorMcpServer } from "./client.ts";

/** Runtime-local capability proxy: agents never receive the durable Executor credential.
 * Every request rechecks the saved profile, so disable/disconnect applies to existing sessions. */
export function createExecutorGateway(
	readProfile: () => Promise<ExecutorProfile | null>,
	fetcher: typeof fetch = fetch,
) {
	const token = randomBytes(32).toString("hex");
	let server: Server | null = null;
	let listening: Promise<string> | null = null;
	let active = 0;
	const requests = new Set<AbortController>();
	const start = () =>
		(listening ??= new Promise<string>((resolve, reject) => {
			server = createServer(async (req, res) => {
				const candidate = Buffer.from(req.headers.authorization ?? "");
				const expected = Buffer.from(`Bearer ${token}`);
				if (
					candidate.length !== expected.length ||
					!timingSafeEqual(candidate, expected)
				) {
					res.writeHead(401).end();
					return;
				}
				if (
					req.url !== "/mcp" ||
					!["GET", "POST", "DELETE"].includes(req.method ?? "")
				) {
					res.writeHead(404).end();
					return;
				}
				if (active >= 32) {
					res.writeHead(429).end("Executor is busy. Retry shortly.");
					return;
				}
				active++;
				const abort = new AbortController();
				requests.add(abort);
				res.on("close", () => abort.abort());
				try {
					const profile = await readProfile();
					if (!profile?.enabled) {
						res.writeHead(403).end("Executor is disconnected or disabled.");
						return;
					}
					const remote = executorMcpServer(profile);
					const chunks: Buffer[] = [];
					let bytes = 0;
					for await (const chunk of req) {
						bytes += chunk.length;
						if (bytes > 4 * 1024 * 1024) {
							res.writeHead(413).end();
							return;
						}
						chunks.push(Buffer.from(chunk));
					}
					const headers = new Headers(remote.headers);
					for (const name of [
						"accept",
						"content-type",
						"mcp-protocol-version",
						"mcp-session-id",
						"last-event-id",
					]) {
						const value = req.headers[name];
						if (typeof value === "string") headers.set(name, value);
					}
					const response = await fetcher(remote.url!, {
						method: req.method,
						headers,
						redirect: "error",
						body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
						signal: AbortSignal.any([
							abort.signal,
							AbortSignal.timeout(600000),
						]),
					});
					for (const name of [
						"content-type",
						"mcp-session-id",
						"mcp-protocol-version",
						"retry-after",
					]) {
						const value = response.headers.get(name);
						if (value) res.setHeader(name, value);
					}
					res.writeHead(response.status);
					if (response.body) {
						const reader = response.body.getReader();
						try {
							let downloaded = 0;
							while (!abort.signal.aborted) {
								const next = await reader.read();
								if (next.done) break;
								downloaded += next.value.byteLength;
								if (downloaded > 16 * 1024 * 1024)
									throw new Error("Executor response exceeds the limit.");
								if (!res.write(next.value))
									await new Promise<void>((done) => {
										const finish = () => {
											res.off("drain", finish);
											res.off("close", finish);
											done();
										};
										res.once("drain", finish);
										res.once("close", finish);
									});
							}
						} finally {
							await reader.cancel();
							reader.releaseLock();
						}
					}
					res.end();
				} catch {
					if (!res.headersSent)
						res
							.writeHead(502)
							.end(
								"Executor is unavailable. Check Plugins settings and retry.",
							);
					else res.destroy();
				} finally {
					active--;
					requests.delete(abort);
				}
			});
			server.requestTimeout = 30000;
			server.on("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server?.address();
				if (!address || typeof address === "string") {
					reject(new Error("Could not start Executor bridge."));
					return;
				}
				resolve(`http://127.0.0.1:${address.port}/mcp`);
			});
		}));
	return {
		async servers(): Promise<ReadonlyArray<ResolvedMcpServer>> {
			const profile = await readProfile();
			if (!profile?.enabled) return [];
			return [
				{
					name: "zuse_executor",
					transport: "http",
					url: await start(),
					headers: { Authorization: `Bearer ${token}` },
				},
			];
		},
		async close() {
			for (const request of requests) request.abort();
			if (server) {
				server.closeAllConnections();
				await new Promise<void>((resolve) => server!.close(() => resolve()));
			}
		},
	};
}
