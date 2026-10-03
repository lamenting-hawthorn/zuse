import type { PluginDefinition } from "@zuse/contracts";

export interface CatalogPlugin extends PluginDefinition {
	readonly endpoint: string;
	readonly origins: readonly string[];
	readonly scopes: readonly string[];
}
// Server-owned endpoints only. Add providers after checking their MCP auth and
// metadata origins; clients never supply endpoints, headers, or client secrets.
export const PLUGIN_CATALOG: readonly CatalogPlugin[] = [
	{
		id: "linear",
		name: "Linear",
		description: "Find and update issues, projects, and documents.",
		auth: "oauth",
		endpoint: "https://mcp.linear.app/mcp",
		origins: [
			"https://mcp.linear.app",
			"https://api.linear.app",
			"https://linear.app",
		],
		scopes: ["read", "write"],
	},
	{
		id: "cloudflare",
		name: "Cloudflare Docs",
		description: "Search Cloudflare documentation from your agents.",
		auth: "none",
		endpoint: "https://docs.mcp.cloudflare.com/mcp",
		origins: ["https://docs.mcp.cloudflare.com"],
		scopes: [],
	},
];
export const publicPluginCatalog = () =>
	PLUGIN_CATALOG.map(({ id, name, description, auth }) => ({
		id,
		name,
		description,
		auth,
	}));
export const assertPluginUrl = (value: string) => {
	const url = new URL(value);
	if (
		url.username ||
		url.password ||
		url.protocol !== "https:" ||
		!PLUGIN_CATALOG.some((p) => p.origins.includes(url.origin))
	)
		throw new Error("Plugin endpoint is not allowed");
};
