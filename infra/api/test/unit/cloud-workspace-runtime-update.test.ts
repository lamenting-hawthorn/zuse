import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { WORKSPACE_RUNTIME_UPDATE_SCRIPT } from "../../src/cloud-workspace-runtime-update.ts";

test.each([
	{ name: "old image", version: 5, updates: 1, success: true },
	{ name: "compatible image", version: 6, updates: 0, success: true },
	{ name: "missing metadata", version: null, updates: 1, success: true },
	{ name: "invalid metadata", version: "broken", updates: 1, success: true },
	{
		name: "updater failure",
		version: 5,
		updates: 1,
		success: false,
		fail: true,
	},
	{
		name: "incompatible installed artifact",
		version: 5,
		updates: 1,
		success: false,
		installedVersion: 5,
	},
	{
		name: "missing signing key",
		version: 5,
		updates: 0,
		success: false,
		missingKey: true,
	},
	{
		name: "explicit restart applies fixes",
		version: 6,
		updates: 1,
		success: true,
		force: true,
	},
])("runtime startup: $name", async (scenario) => {
	const root = await mkdtemp(join(tmpdir(), "zuse-runtime-start-"));
	try {
		const status = join(root, "workspace");
		const current = join(root, "current");
		const updater = join(root, "updater.mjs");
		const key = join(root, "public.jwk");
		await mkdir(current);
		await mkdir(status);
		// The compatibility gate must not initialize, move, or replace runtime data.
		const database = join(status, "zuse.sqlite");
		await writeFile(database, "existing chat and queued command");
		if (!scenario.missingKey) await writeFile(key, "test key");
		if (scenario.version !== null) {
			await writeFile(
				join(current, "runtime-metadata.json"),
				scenario.version === "broken"
					? "invalid JSON"
					: JSON.stringify({
							schemaVersion: 1,
							wireProtocolVersion: scenario.version,
						}),
			);
		}
		await writeFile(
			updater,
			`
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(root, "updated"))}, "updated");
if (process.env.ZUSE_RUNTIME_INSTALL_ONLY !== "1" || process.env.ZUSE_RUNTIME_SKIP_TOOLCHAIN !== "1") process.exit(2);
if (${JSON.stringify(scenario.fail ?? false)}) process.exit(1);
writeFileSync(${JSON.stringify(join(current, "runtime-metadata.json"))}, JSON.stringify({ schemaVersion: 1, wireProtocolVersion: ${scenario.installedVersion ?? 6} }));
`,
		);
		const script = WORKSPACE_RUNTIME_UPDATE_SCRIPT.replaceAll(
			"/var/lib/zuse/workspace",
			status,
		).replaceAll("/usr/local/lib/zuse/runtime-updater.mjs", updater);
		const result = spawnSync(
			"bash",
			[
				"-c",
				`set -e\n${script}\nensure_workspace_runtime ${scenario.force ? "1" : "0"}\nprintf launched`,
			],
			{
				encoding: "utf8",
				timeout: 5_000,
				env: {
					...process.env,
					ZUSE_CURRENT_LINK: current,
					ZUSE_RUNTIME_MANIFEST_URL: "https://runtime.invalid/manifest.json",
					ZUSE_RUNTIME_PUBLIC_KEY_FILE: key,
					ZUSE_RUNTIME_WIRE_PROTOCOL: "6",
				},
			},
		);
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(scenario.success ? 0 : 1);
		expect(result.stdout).toBe(scenario.success ? "launched" : "");
		expect(await readFile(join(root, "updated"), "utf8").catch(() => "")).toBe(
			scenario.updates ? "updated" : "",
		);
		if (!scenario.success) {
			expect(await readFile(join(status, "failure-phase"), "utf8")).toBe(
				"updating-runtime\n",
			);
		}
		expect(await readFile(database, "utf8")).toBe(
			"existing chat and queued command",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
