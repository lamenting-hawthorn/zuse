import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const server = await createServer({
	configFile: false,
	root: fileURLToPath(new URL("../..", import.meta.url)),
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "panel-tabs-fixture",
			configureServer(server) {
				server.middlewares.use("/tabs-fixture", async (_request, response) => {
					response.setHeader("Content-Type", "text/html");
					response.end(
						await server.transformIndexHtml(
							"/tabs-fixture",
							'<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/workspace-panel-tabs.tsx"></script>',
						),
					);
				});
			},
		},
	],
	server: { host: "127.0.0.1", port: 0 },
});
let browser;
try {
	await server.listen();
	browser = await chromium.launch({
		executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
		headless: true,
		args: ["--no-sandbox"],
	});
	const page = await browser.newPage({ deviceScaleFactor: 2 });
	await page.goto(`${server.resolvedUrls.local[0]}tabs-fixture`);
	await page.locator(".workspace-panel-tab").first().waitFor();
	for (const zoom of [1, 1.25, 2]) {
		await page.evaluate((zoom) => {
			document.body.style.zoom = String(zoom);
		}, zoom);
		const boxes = await page
			.locator(".workspace-panel-tab")
			.evaluateAll((elements) =>
				elements.map((element) => {
					const rect = element.getBoundingClientRect();
					const parent = element.parentElement.getBoundingClientRect();
					return {
						height: rect.height,
						top: rect.top - parent.top,
						left: rect.left - parent.left,
					};
				}),
			);
		assert.deepEqual(
			boxes.map((box) => box.height),
			[24, 24, 24].map((height) => height * zoom),
		);
		assert.deepEqual(
			boxes.map((box) => box.top),
			[8, 8, 8].map((top) => top * zoom),
		);
		assert.equal(boxes[0].left, boxes[0].top);
	}
	console.log(
		"Panel tabs: identical 24px heights and equal 8px top/left insets at 100%, 125%, and 200% zoom.",
	);
} finally {
	await browser?.close();
	await server.close();
}
