import { describe, expect, it } from "vitest";
import {
	type ExecutorProfile,
	executorAddress,
	executorCatalog,
	executorMcpServer,
} from "../../src/executor/client.ts";

const profile: ExecutorProfile = {
	url: "https://executor.example.com",
	token: "private-key",
	enabled: true,
	toolkit: null,
};
describe("shared Executor catalog", () => {
	it("accepts HTTPS and loopback but rejects credential/query/path URLs and plaintext remote hosts", () => {
		expect(executorAddress("https://executor.example.com/").url).toBe(
			profile.url,
		);
		expect(executorAddress("http://127.0.0.1:4788").url).toBe(
			"http://127.0.0.1:4788",
		);
		for (const url of [
			"http://executor.example.com",
			"https://key@example.com",
			"https://example.com/?token=a",
			"https://example.com/api",
			"https://example.com/team/mcp/extra",
			"https://example.com/team/mcp?token=secret",
			"https://example.com/team%2fother/mcp",
			"file:///tmp/key",
		])
			expect(() => executorAddress(url)).toThrow();
	});
	it("preserves organization scope for hosted MCP, toolkits, catalog requests and console links", async () => {
		const hosted = { ...profile, url: "https://executor.sh/example-team/mcp" };
		expect(executorAddress(`${hosted.url}/`).url).toBe(hosted.url);
		expect(executorMcpServer(hosted).url).toBe(hosted.url);
		expect(executorMcpServer({ ...hosted, toolkit: "review" }).url).toBe(
			`${hosted.url}/toolkits/review`,
		);
		const paths: string[] = [];
		const result = await executorCatalog(
			hosted,
			undefined,
			async (input, init) => {
				const url = new URL(String(input));
				paths.push(url.pathname);
				expect(url.origin).toBe("https://executor.sh");
				expect(new Headers(init?.headers).get("x-executor-organization")).toBe(
					"example-team",
				);
				expect(new Headers(init?.headers).get("Authorization")).toBe(
					"Bearer private-key",
				);
				return Response.json(
					url.pathname === "/api/toolkits" ? { toolkits: [] } : [],
				);
			},
		);
		expect(paths.sort()).toEqual([
			"/api/connections",
			"/api/integrations",
			"/api/toolkits",
		]);
		expect(result.url).toBe(hosted.url);
		expect(result.consoleUrl).toBe("https://executor.sh/example-team");
		expect(executorAddress(`${profile.url}/mcp`).url).toBe(profile.url);
	});
	it("returns only public catalog fields and retains multiple accounts", async () => {
		const fetcher: typeof fetch = async (input, init) => {
			expect(init?.redirect).toBe("error");
			expect(new Headers(init?.headers).has("x-executor-organization")).toBe(
				false,
			);
			expect(new Headers(init?.headers).get("Authorization")).toBe(
				"Bearer private-key",
			);
			const path = new URL(String(input)).pathname;
			const result =
				path === "/api/integrations"
					? [
							{
								slug: "github",
								name: "GitHub",
								description: "Issues",
								kind: "openapi",
								authMethods: [{ kind: "apikey" }],
								secret: "must-drop",
							},
						]
					: path === "/api/connections"
						? ["work", "personal"].map((name) => ({
								owner: "user",
								integration: "github",
								name,
								identityLabel: name,
								expiresAt: null,
								secret: "must-drop",
							}))
						: { toolkits: [{ id: "1", slug: "review", name: "Review" }] };
			return Response.json(result);
		};
		const catalog = await executorCatalog(profile, undefined, fetcher);
		expect(catalog.connections).toHaveLength(2);
		expect(JSON.stringify(catalog)).not.toMatch(/private-key|must-drop/);
	});
	it("does not expose upstream response bodies for authentication errors", async () => {
		await expect(
			executorCatalog(
				profile,
				undefined,
				async () => new Response("secret-in-error", { status: 401 }),
			),
		).rejects.toThrow("authentication failed");
	});
	it("rejects oversized and incompatible catalogs", async () => {
		await expect(
			executorCatalog(
				profile,
				undefined,
				async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
			),
		).rejects.toThrow("download limit");
		await expect(
			executorCatalog(profile, undefined, async () =>
				Response.json({ token: "secret" }),
			),
		).rejects.toThrow("incompatible catalog");
	});
	it("uses the toolkit endpoint without putting a key in the URL", () => {
		const server = executorMcpServer({ ...profile, toolkit: "review" });
		expect(server.url).toBe(`${profile.url}/mcp/toolkits/review`);
		expect(server.url).not.toContain(profile.token);
	});
});

// Exercise real credential persistence and replacement, not just catalog parsing.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";
import { executeExecutor } from "../../src/executor/handlers.ts";
import { readExecutorProfile } from "../../src/executor/service.ts";
import { makeFileCredentialsService } from "../../src/provider/layers/file-credentials-service.ts";

const directories: string[] = [];
afterEach(async () => {
	vi.unstubAllGlobals();
	await Promise.all(
		directories
			.splice(0)
			.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});
it("keeps the last working connection on failed replacement, supports offline disable, and persists across runtimes", async () => {
	const directory = await mkdtemp(join(tmpdir(), "zuse-executor-test-"));
	directories.push(directory);
	const layer = makeFileCredentialsService(directory);
	const fetcher = vi.fn(async (input: string) =>
		Response.json(
			input.endsWith("/toolkits")
				? { toolkits: [{ id: "1", slug: "review", name: "Review" }] }
				: [],
		),
	);
	vi.stubGlobal("fetch", fetcher);
	const connected = await Effect.runPromise(
		executeExecutor({
			_tag: "connect",
			url: profile.url,
			token: profile.token,
		}).pipe(Effect.provide(layer)),
	);
	expect(connected.configured).toBe(true);
	expect(JSON.stringify(connected)).not.toContain(profile.token);
	await Effect.runPromise(
		executeExecutor({
			_tag: "configure",
			enabled: true,
			toolkit: "review",
		}).pipe(Effect.provide(layer)),
	);
	fetcher.mockRejectedValue(new Error("upstream-secret"));
	await expect(
		Effect.runPromise(
			executeExecutor({
				_tag: "connect",
				url: "https://different.example.com",
				token: "bad",
			}).pipe(Effect.provide(layer)),
		),
	).rejects.toMatchObject({
		reason: expect.stringContaining("Could not update Executor"),
	});
	const saved = await Effect.runPromise(
		readExecutorProfile().pipe(
			Effect.provide(makeFileCredentialsService(directory)),
		),
	);
	expect(saved).toMatchObject({
		url: profile.url,
		token: profile.token,
		toolkit: "review",
	});
	const disabled = await Effect.runPromise(
		executeExecutor({
			_tag: "configure",
			enabled: false,
			toolkit: "review",
		}).pipe(Effect.provide(layer)),
	);
	expect(disabled.enabled).toBe(false);
	expect(disabled.error).not.toContain("upstream-secret");
	await Effect.runPromise(
		executeExecutor({ _tag: "disconnect" }).pipe(Effect.provide(layer)),
	);
	expect(
		await Effect.runPromise(
			readExecutorProfile().pipe(
				Effect.provide(makeFileCredentialsService(directory)),
			),
		),
	).toBeNull();
});
it("rejects nonexistent toolkits without changing the saved permissions", async () => {
	const directory = await mkdtemp(join(tmpdir(), "zuse-executor-scope-"));
	directories.push(directory);
	const layer = makeFileCredentialsService(directory);
	vi.stubGlobal("fetch", async (input: string) =>
		Response.json(input.endsWith("/toolkits") ? { toolkits: [] } : []),
	);
	await Effect.runPromise(
		executeExecutor({
			_tag: "connect",
			url: profile.url,
			token: profile.token,
		}).pipe(Effect.provide(layer)),
	);
	await expect(
		Effect.runPromise(
			executeExecutor({
				_tag: "configure",
				enabled: true,
				toolkit: "not-found",
			}).pipe(Effect.provide(layer)),
		),
	).rejects.toMatchObject({ reason: expect.stringContaining("unavailable") });
	expect(
		(await Effect.runPromise(readExecutorProfile().pipe(Effect.provide(layer))))
			?.toolkit,
	).toBeNull();
});
