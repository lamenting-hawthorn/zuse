import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";

const builder = readFileSync(
	new URL("../../../cloud-sandboxes/project-builder.sh", import.meta.url),
	"utf8",
);
// Exercise the actual production guard, with real Git tree output and pipefail.
const guard = builder.slice(
	builder.indexOf("\t\t# Drain the listing:"),
	builder.indexOf('\t\tgit -C "$workspace_path" config --unset-all'),
);

test.each([
	[".env.analytics.example", false],
	["apps/web/.env.production.sample", false],
	["config/.env.analytics.template", false],
	[".env.example", false],
	[".env.sample", false],
	[".env.template", false],
	[".env", true],
	["apps/web/.env.local", true],
	[".env.production", true],
	[".env.example.local", true],
	[".env.example/secret", true],
	[".env.production.example/secret", true],
])("snapshot guard handles %s (blocked: %s)", (filename, blocked) => {
	const root = mkdtempSync(join(tmpdir(), "zuse-snapshot-env-"));
	try {
		const git = (...args: string[]) => {
			const result = spawnSync("git", ["-C", root, ...args], {
				encoding: "utf8",
			});
			expect(result.status, result.stderr).toBe(0);
			return result.stdout.trim();
		};
		git("init", "--quiet");
		mkdirSync(dirname(join(root, filename)), { recursive: true });
		writeFileSync(join(root, filename), "TEST_SECRET_DO_NOT_LOG");
		git("add", "--", filename);
		const tree = git("write-tree");
		const result = spawnSync(
			"bash",
			["-c", `set -euo pipefail\nmark_failed() { exit "$1"; }\n${guard}`],
			{
				encoding: "utf8",
				env: { ...process.env, workspace_path: root, source_commit: tree },
			},
		);
		expect(result.status).toBe(blocked ? 71 : 0);
		if (blocked) expect(result.stdout + result.stderr).toContain(filename);
		expect(result.stdout + result.stderr).not.toContain(
			"TEST_SECRET_DO_NOT_LOG",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
