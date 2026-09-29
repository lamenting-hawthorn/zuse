import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, type Server } from "node:net";
import { describe, expect, it } from "vitest";
import { isHttpPreview } from "../../src/port-inspector.js";

const listening = (server: Server): Promise<number> =>
	new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address && typeof address !== "string") resolve(address.port);
		});
	});
const close = (server: Server): Promise<void> =>
	new Promise((resolve) => server.close(() => resolve()));

describe("HTTP preview verification", () => {
	it("accepts app error responses without following redirects or reading bodies", async () => {
		const methods: string[] = [];
		const server = createHttpServer((req, res) => {
			methods.push(req.method ?? "");
			res.writeHead(404);
			res.end();
		});
		const port = await listening(server);
		try {
			expect(await isHttpPreview(port)).toBe(true);
			expect(methods).toEqual(["HEAD"]);
		} finally {
			await close(server);
		}
	});
	it("rejects an SSH listener on an arbitrary high port", async () => {
		const server = createTcpServer((socket) => {
			socket.on("error", () => {});
			socket.resume();
			socket.end("SSH-2.0-OpenSSH\r\n");
		});
		const port = await listening(server);
		try {
			expect(await isHttpPreview(port)).toBe(false);
		} finally {
			await close(server);
		}
	});
	it("bounds the wait for a non-HTTP socket", async () => {
		const server = createTcpServer((socket) => {
			socket.on("error", () => {});
			socket.resume();
		});
		const port = await listening(server);
		try {
			expect(await isHttpPreview(port)).toBe(false);
		} finally {
			await close(server);
		}
	});
});
