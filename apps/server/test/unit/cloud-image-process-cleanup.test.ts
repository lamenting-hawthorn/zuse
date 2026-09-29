import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const builder = fileURLToPath(
	new URL(
		"../../../../infra/cloud-sandboxes/project-builder.sh",
		import.meta.url,
	),
);
const fixture = `
const {spawn}=require('node:child_process');
process.on('SIGTERM',()=>{});
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
console.log(JSON.stringify({parent:process.pid,child:child.pid}));
setInterval(()=>{},1000);
`;
const start = (
	authHome: string,
): Promise<{ process: ChildProcess; parent: number; child: number }> =>
	new Promise((resolve, reject) => {
		const process = spawn(
			"flock",
			[
				"-x",
				`${authHome}/initialize.lock`,
				globalThis.process.execPath,
				"-e",
				fixture,
				`${authHome}/bootstrap/initialize.mjs`,
			],
			{ detached: true, stdio: ["ignore", "pipe", "pipe"] },
		);
		process.once("error", reject);
		process.stdout?.once("data", (data) =>
			resolve({ process, ...JSON.parse(data.toString()) }),
		);
	});
const isRunning = (pid: number) => {
	const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
		encoding: "utf8",
	});
	return result.status === 0 && !result.stdout.trim().startsWith("Z");
};

test.skipIf(process.platform !== "linux")(
	"stops inherited auth trees in the build clone while preserving unrelated processes",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "zuse-image-processes-"));
		const children: ChildProcess[] = [];
		try {
			await mkdir(join(root, "clone-auth"));
			await mkdir(join(root, "source-auth"));
			const inherited = await start(join(root, "clone-auth"));
			children.push(inherited.process);
			const queuedMarker = join(root, "queued-ran");
			const queued = spawn(
				"flock",
				[
					"-x",
					join(root, "clone-auth/initialize.lock"),
					process.execPath,
					"-e",
					'require("node:fs").writeFileSync(process.argv[1],"unsafe")',
					queuedMarker,
				],
				{ detached: true, stdio: "ignore" },
			);
			children.push(queued);
			await new Promise((resolve) => setTimeout(resolve, 30));
			const unrelated = await start(join(root, "source-auth"));
			children.push(unrelated.process);
			const run = () =>
				spawnSync(
					"bash",
					[
						"-c",
						'source "$1"; quiesce_auth_processes "$2" "$3"',
						"bash",
						builder,
						join(root, "clone-auth"),
						String(process.getuid?.()),
					],
					{ encoding: "utf8", timeout: 10000 },
				);
			const result = run();
			expect(result.status, result.stderr).toBe(0);
			expect(isRunning(inherited.parent)).toBe(false);
			if (inherited.process.pid === undefined || queued.pid === undefined) {
				throw new Error("Fixture processes did not start");
			}
			expect(isRunning(inherited.process.pid)).toBe(false);
			expect(isRunning(queued.pid)).toBe(false);
			expect(existsSync(queuedMarker)).toBe(false);
			expect(isRunning(inherited.child)).toBe(false);
			expect(isRunning(unrelated.parent)).toBe(true);
			expect(isRunning(unrelated.child)).toBe(true);
			expect(run().status).toBe(0);
		} finally {
			for (const child of children)
				if (child.pid) {
					try {
						process.kill(-child.pid, "SIGKILL");
					} catch {}
				}
			await rm(root, { recursive: true, force: true });
		}
	},
);

test("quiesces the build clone before repository sync and auth file removal", async () => {
	const script = await readFile(builder, "utf8");
	const main = script.slice(script.indexOf("main() {"));
	const cleanup = main.indexOf(
		"quiesce_auth_processes /home/zuse/.zuse/cloud-auth",
	);
	expect(cleanup).toBeGreaterThan(0);
	expect(cleanup).toBeLessThan(main.indexOf("phase=syncing-repository"));
	expect(cleanup).toBeLessThan(main.indexOf("phase=sanitizing-snapshot"));
	expect(main).toContain("pgrep -u zuse -f '(gh auth|claude|codex|grok)'");
});
