import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("terminates command descendants when the owning server is killed", async () => {
	const directory = await mkdtemp(join(tmpdir(), "zuse-supervisor-"));
	const moduleUrl = new URL(
		"../../src/process/process-group.ts",
		import.meta.url,
	).href;
	const source = `import { spawnSupervisedCommand } from ${JSON.stringify(moduleUrl)};
 const child = spawnSupervisedCommand('printf ready; sleep 1; printf orphan > marker', ${JSON.stringify(directory)});
 child.stdout.on('data', data => process.stdout.write(data));
 setInterval(() => {}, 1000);`;
	const parent = spawn(
		process.execPath,
		["--import", "tsx", "--input-type=module", "-e", source],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	try {
		await Promise.race([
			once(parent.stdout, "data"),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("Supervisor did not start")), 3000),
			),
		]);
		parent.kill("SIGKILL");
		await once(parent, "exit");
		await new Promise((resolve) => setTimeout(resolve, 1300));
		await expect(readFile(join(directory, "marker"))).rejects.toThrow();
	} finally {
		parent.kill("SIGKILL");
		await rm(directory, { recursive: true, force: true });
	}
});

it("enforces the lease independently while the parent stays alive", async () => {
	const { spawnSupervisedCommand } = await import(
		"../../src/process/process-group.ts"
	);
	const directory = await mkdtemp(join(tmpdir(), "zuse-watchdog-"));
	const child = spawnSupervisedCommand(
		"printf ready; sleep 5; printf orphan > marker",
		directory,
		Date.now() + 500,
	);
	try {
		await once(child, "close");
		await expect(readFile(join(directory, "marker"))).rejects.toThrow();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it("accepts fresh leases through the private pipe without restarting the command", async () => {
	const { spawnSupervisedCommand } = await import(
		"../../src/process/process-group.ts"
	);
	const child = spawnSupervisedCommand(
		"printf ready; sleep 1; exit 7",
		tmpdir(),
		Date.now() + 500,
	);
	try {
		if (!child.stdout || !child.stdin)
			throw new Error("Missing supervisor pipes");
		await once(child.stdout, "data");
		child.stdin.write(`${Date.now() + 3000}\n`);
		const [code] = await once(child, "close");
		expect(code).toBe(7);
	} finally {
		child.kill("SIGKILL");
	}
});

it.each([
	false,
	true,
])("only reaps descendants on normal exit when opted in (%s)", async (killDescendantsOnExit) => {
	const { spawnSupervisedCommand } = await import(
		"../../src/process/process-group.ts"
	);
	const directory = await mkdtemp(join(tmpdir(), "zuse-exit-policy-"));
	const child = spawnSupervisedCommand(
		"(sleep 0.4; printf survived > marker) & exit 0",
		directory,
		undefined,
		{ killDescendantsOnExit },
	);
	try {
		await once(child, "exit");
		await new Promise((resolve) => setTimeout(resolve, 650));
		if (killDescendantsOnExit)
			await expect(readFile(join(directory, "marker"))).rejects.toThrow();
		else
			expect(await readFile(join(directory, "marker"), "utf8")).toBe(
				"survived",
			);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
it("falls back to sh for an empty SHELL", async () => {
	const { spawnSupervisedCommand } = await import(
		"../../src/process/process-group.ts"
	);
	const previous = process.env.SHELL;
	process.env.SHELL = "";
	try {
		const child = spawnSupervisedCommand("exit 0", tmpdir());
		expect((await once(child, "close"))[0]).toBe(0);
	} finally {
		if (previous === undefined) delete process.env.SHELL;
		else process.env.SHELL = previous;
	}
});
