import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite-plus";

const root = resolve(import.meta.dirname, "../..");
const server = await createServer({
	root,
	configFile: resolve(root, "vite.config.ts"),
	server: {
		host: "127.0.0.1",
		port: 15834,
		strictPort: true,
		hmr: false,
		watch: null,
	},
	plugins: [
		{
			name: "plugins-ui-fixture",
			enforce: "pre",
			configureServer(s) {
				s.middlewares.use("/__plugins", async (_req, res) => {
					res.setHeader("Content-Type", "text/html");
					res.end(
						await s.transformIndexHtml(
							"/__plugins.html",
							'<html class="dark"><div id="root"></div><script type="module" src="/@id/__x00__plugins-probe"></script></html>',
						),
					);
				});
			},
			resolveId(id, importer) {
				if (id === "\0plugins-probe") return id;
				if (
					importer?.includes("plugins-pane.tsx") ||
					importer?.includes("plugin-confirmation.tsx")
				) {
					if (id.endsWith("plugins-client.ts")) return "\0plugins-fixture";
					if (id.endsWith("use-auth.ts")) return "\0plugins-auth";
					if (id.endsWith("platform-capabilities.ts"))
						return "\0plugins-external";
				}
			},
			load(id) {
				if (id === "\0plugins-auth")
					return 'export const useAuth=()=>({user:{id:"fixture",email:"user@example.test"},isSignedIn:true});';
				if (id === "\0plugins-external")
					return "export const openExternal=async url=>{window.openedPluginUrl=url;};";
				if (id === "\0plugins-fixture")
					return `
const catalog=[{id:'linear',name:'Linear',description:'Find and update issues, projects, and documents.',auth:'oauth'},{id:'cloudflare',name:'Cloudflare Docs',description:'Search Cloudflare documentation from your agents.',auth:'none'}];
let connections=[];
export async function pluginRequest(input){
 if(input.action==='complete')return {kind:'attempt',state:'connected'};
 if(input.action==='list')return {kind:'snapshot',tenantId:'personal:fixture',tenants:[{id:'personal:fixture',kind:'personal',name:'Personal'}],catalog,connections,endpoint:''};
 if(input.action==='disconnect'){connections=connections.filter(c=>c.id!==input.connectionId);return {kind:'ok'};}
 if(input.action==='connect'){const id=input.requestId;connections.push({id,pluginId:input.pluginId,label:input.label,owner:'user',state:'connected',createdAt:Date.now()});return {kind:'attempt',id,connectionId:id,state:'connected',authorizationUrl:null,expiresAt:Date.now()+60000};}
}
`;
				if (id === "\0plugins-probe")
					return `import React from 'react';import{createRoot}from'react-dom/client';import{PluginsPane}from'/src/components/settings/plugins-pane.tsx';import{PluginConfirmation}from'/src/components/plugin-confirmation.tsx';import '/src/styles.css';createRoot(document.getElementById('root')).render(React.createElement('main',{className:'min-h-screen bg-background text-foreground',style:{padding:'36px'}},React.createElement('div',{style:{maxWidth:960,margin:'0 auto'}},React.createElement(React.Fragment,null,React.createElement(PluginConfirmation),React.createElement(PluginsPane)))));`;
			},
		},
	],
});
let browser;
try {
	await server.listen();
	browser = await chromium.launch({
		headless: true,
		...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
			? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
			: {}),
	});
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(
		"http://127.0.0.1:15834/__plugins?plugin_ticket=fixture&plugin_tenant=personal%3Afixture",
	);
	await page
		.getByRole("button", { name: "Confirm connection", exact: true })
		.click();
	await page
		.getByRole("status")
		.filter({ hasText: "Connected. You can return" })
		.waitFor();
	assert(!page.url().includes("plugin_ticket"));
	await page.getByRole("button", { name: "Close", exact: true }).click();
	await page
		.getByRole("textbox", { name: "Search plugins" })
		.fill("Cloudflare");
	assert.equal(
		await page
			.getByRole("button", { name: "Connect Linear", exact: true })
			.count(),
		0,
	);
	await page
		.getByRole("button", { name: "Connect Cloudflare Docs", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Manage Cloudflare Docs", exact: true })
		.click();
	await page.getByRole("heading", { name: "Your connections" }).waitFor();
	await page.getByRole("button", { name: "Disconnect", exact: true }).click();
	await page.getByText("No connections yet.", { exact: true }).waitFor();
	await page.getByRole("button", { name: "All plugins", exact: true }).click();
	await page.getByRole("textbox", { name: "Search plugins" }).fill("");
	await page.getByRole("button", { name: "Connected", exact: true }).click();
	await page
		.getByText("Your connected plugins will appear here.", { exact: true })
		.waitFor();
	assert.deepEqual(errors, []);
	console.log(
		"PASS: plugin confirmation, search, connect, details, disconnect, and empty state",
	);
} finally {
	await browser?.close();
	await server.close();
}
