import { expect, it } from "vitest";
import {
	sharedAcpMcpServers,
	sharedCodexMcpConfig,
} from "../../src/user-mcp/shared.ts";

const server = {
	name: "zuse_executor",
	transport: "http" as const,
	url: "http://127.0.0.1:1234/mcp",
	headers: { Authorization: "Bearer ephemeral-token" },
};
it("uses Codex environment references instead of putting credentials on its command line", () => {
	const config = sharedCodexMcpConfig([server]);
	expect(config.args.join(" ")).not.toContain("ephemeral-token");
	expect(config.args.join(" ")).toContain("env_http_headers");
	expect(Object.values(config.env)).toEqual(["Bearer ephemeral-token"]);
});
it("forwards HTTP MCP configuration and bridges stdio-only ACP clients", async () => {
	expect(await sharedAcpMcpServers([server], true)).toEqual([
		{
			type: "http",
			name: server.name,
			url: server.url,
			headers: [{ name: "Authorization", value: "Bearer ephemeral-token" }],
		},
	]);
	const [stdio] = await sharedAcpMcpServers([server], false);
	expect(stdio).toMatchObject({
		name: "zuse_executor",
		command: process.execPath,
		env: expect.arrayContaining([
			{ name: "ZUSE_APP_MCP_URL", value: server.url },
			{ name: "ZUSE_APP_MCP_TOKEN", value: "ephemeral-token" },
		]),
	});
});
it("does not silently drop unsupported authentication on stdio fallback", async () => {
	await expect(
		sharedAcpMcpServers(
			[{ ...server, headers: { "X-API-Key": "secret" } }],
			false,
		),
	).rejects.toThrow("authentication");
});
