import { afterEach, expect, it } from "vitest";
import type { ExecutorProfile } from "../../src/executor/client.ts";
import { createExecutorGateway } from "../../src/executor/gateway.ts";

const gateways: ReturnType<typeof createExecutorGateway>[] = [];
afterEach(async () => {
	await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
});
const profile: ExecutorProfile = {
	url: "https://executor.example.com",
	token: "durable-secret",
	enabled: true,
	toolkit: null,
};

it("shares the selected account across agent requests without handing its key to agents", async () => {
	let current: ExecutorProfile | null = profile;
	const requests: string[] = [];
	const gateway = createExecutorGateway(
		async () => current,
		async (input, init) => {
			expect(new Headers(init?.headers).get("Authorization")).toBe(
				"Bearer durable-secret",
			);
			requests.push(String(input));
			return Response.json(
				{ jsonrpc: "2.0", id: 1, result: { tools: [] } },
				{ headers: { "mcp-session-id": "remote-session" } },
			);
		},
	);
	gateways.push(gateway);
	const [server] = await gateway.servers();
	expect(server).toBeDefined();
	expect(JSON.stringify(server)).not.toContain(profile.token);
	for (const agent of ["claude", "codex", "acp"]) {
		const response = await fetch(server!.url!, {
			method: "POST",
			headers: server!.headers,
			body: JSON.stringify({ agent }),
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("mcp-session-id")).toBe("remote-session");
		await response.text();
	}
	expect(requests).toHaveLength(3);
	current = { ...profile, enabled: false };
	expect((await fetch(server!.url!, { headers: server!.headers })).status).toBe(
		403,
	);
	current = null;
	expect((await fetch(server!.url!, { headers: server!.headers })).status).toBe(
		403,
	);
	expect(await gateway.servers()).toEqual([]);
	expect(requests).toHaveLength(3);
});
it("rejects missing capability tokens and unknown paths before calling Executor", async () => {
	const gateway = createExecutorGateway(
		async () => profile,
		async () => {
			throw Error("should not call");
		},
	);
	gateways.push(gateway);
	const [server] = await gateway.servers();
	expect((await fetch(server!.url!)).status).toBe(401);
	expect(
		(await fetch(`${server!.url!}/admin`, { headers: server!.headers })).status,
	).toBe(404);
});
it("fails visibly without leaking credentials when Executor is unavailable", async () => {
	const gateway = createExecutorGateway(
		async () => profile,
		async () => {
			throw Error(profile.token);
		},
	);
	gateways.push(gateway);
	const [server] = await gateway.servers();
	const response = await fetch(server!.url!, { headers: server!.headers });
	expect(response.status).toBe(502);
	expect(await response.text()).not.toContain(profile.token);
});
