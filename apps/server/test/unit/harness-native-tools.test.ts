import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	HarnessToolContext,
	HarnessToolOutput,
} from "@zuse/agents/harness/types";
import { afterEach, expect, it } from "vitest";
import { NativeHarnessTools } from "../../src/harness/native-tools.ts";
import type { ProcessNotice } from "../../src/harness/processes.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});
const context: HarnessToolContext = {
	agentId: "root",
	callId: "call",
	signal: new AbortController().signal,
	permissionMode: "default",
	readOnly: false,
};
function json(output: HarnessToolOutput) {
	if (typeof output !== "string") throw new Error("Expected text output");
	return JSON.parse(output);
}
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "zuse-tools-"));
	const cwd = join(directory, "checkout");
	await mkdir(cwd);
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const notices: ProcessNotice[] = [];
	const tools = new NativeHarnessTools({
		rootId: "root",
		directory: join(directory, "artifacts"),
		lockDirectory: join(directory, "locks"),
		cwd,
		runtimeMode: () => "full-access",
		notify: async (notice) => {
			notices.push(notice);
		},
	});
	await tools.initialize();
	cleanup.push(() => tools.close());
	return { tools, cwd, directory, notices };
}
it("requires fresh hashes and validates every multi-edit before writing", async () => {
	const { tools, cwd } = await fixture();
	await tools.execute(
		"write_file",
		{ path: "a.txt", content: "one two one", expected_hash: null },
		context,
	);
	const read = json(
		await tools.execute("read_file", { path: "a.txt" }, context),
	);
	await expect(
		tools.execute(
			"edit_file",
			{
				path: "a.txt",
				expected_hash: read.hash,
				old_string: "one",
				new_string: "x",
			},
			context,
		),
	).rejects.toThrow("Ambiguous");
	await expect(
		tools.execute(
			"multi_edit",
			{
				path: "a.txt",
				expected_hash: read.hash,
				edits: [
					{ old_string: "two", new_string: "three" },
					{ old_string: "missing", new_string: "x" },
				],
			},
			context,
		),
	).rejects.toThrow("not found");
	expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("one two one");
	await tools.execute(
		"multi_edit",
		{
			path: "a.txt",
			expected_hash: read.hash,
			edits: [
				{ old_string: "one", new_string: "x", replace_all: true },
				{ old_string: "two", new_string: "three" },
			],
		},
		context,
	);
	expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("x three x");
	await expect(
		tools.execute(
			"write_file",
			{ path: "a.txt", expected_hash: read.hash, content: "stale" },
			context,
		),
	).rejects.toThrow("Stale");
	await expect(
		tools.execute(
			"write_file",
			{ path: "a.txt", expected_hash: null, content: "overwrite" },
			context,
		),
	).rejects.toThrow();
});
it("serializes competing edits and reads current external changes", async () => {
	const { tools, cwd } = await fixture();
	await writeFile(join(cwd, "a"), "original");
	const { hash } = json(
		await tools.execute("read_file", { path: "a" }, context),
	);
	const results = await Promise.allSettled(
		["first", "second"].map((content) =>
			tools.execute(
				"write_file",
				{ path: "a", expected_hash: hash, content },
				context,
			),
		),
	);
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	await writeFile(join(cwd, "a"), "external");
	expect(
		json(await tools.execute("read_file", { path: "a" }, context)).content,
	).toBe("external");
});
it("checks permissions on every invocation and rejects checkout escapes", async () => {
	const { tools, cwd, directory } = await fixture();
	await writeFile(join(directory, "secret"), "outside");
	await symlink(directory, join(cwd, "escape"));
	await expect(
		tools.execute("read_file", { path: "../secret" }, context),
	).rejects.toThrow("outside");
	await expect(
		tools.execute(
			"write_file",
			{ path: "escape/new", content: "x", expected_hash: null },
			context,
		),
	).rejects.toThrow("outside");
	await expect(
		tools.execute(
			"write_file",
			{ path: "a", content: "x", expected_hash: null },
			{ ...context, permissionMode: "plan" },
		),
	).rejects.toThrow("permission");
	await writeFile(join(cwd, ".env"), "secret");
	await expect(
		tools.execute("read_file", { path: ".env" }, context),
	).rejects.toThrow("permission");
});
it("bounds text output and preserves full local artifacts; returns image content", async () => {
	const { tools, cwd } = await fixture();
	await writeFile(join(cwd, "large"), "x".repeat(80_000));
	const output = json(
		await tools.execute("read_file", { path: "large" }, context),
	);
	expect(output.truncated).toBe(true);
	expect(
		JSON.parse(await readFile(output.artifact, "utf8")).content,
	).toHaveLength(80_000);
	await writeFile(
		join(cwd, "image.png"),
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
			"base64",
		),
	);
	expect(
		await tools.execute("read_image", { path: "image.png" }, context),
	).toMatchObject({
		type: "content",
		value: [{ type: "file", mediaType: "image/png" }],
	});
});
it("supports background stdin, ready notifications, cursor output and completion", async () => {
	const { tools, notices } = await fixture();
	const initial = json(
		await tools.execute(
			"exec_command",
			{
				command: "printf READY; read -r value; printf '%s' \"$value\"",
				yield_time_ms: 0,
				notify_on_output: "READY",
			},
			context,
		),
	);
	const id = initial.process.id;
	await tools.execute(
		"write_stdin",
		{ process_id: id, data: "hello\n", eof: true },
		context,
	);
	await tools.execute(
		"wait_process",
		{ process_id: id, timeout_ms: 3000 },
		context,
	);
	const output = json(
		await tools.execute("process_output", { process_id: id }, context),
	);
	expect(output.text).toBe("READYhello");
	expect(output.process.status).toBe("exited");
	expect(output.process.exitCode).toBe(0);
	expect(
		json(
			await tools.execute(
				"process_output",
				{ process_id: id, cursor: output.next_cursor },
				context,
			),
		).text,
	).toBe("");
	expect(notices.map((n) => n.kind)).toEqual(["ready", "completed"]);
	await expect(
		tools.execute(
			"process_output",
			{ process_id: id },
			{ ...context, agentId: "sibling" },
		),
	).rejects.toThrow("Unknown process");
});
it("stops idle-owned background commands and enforces timeouts", async () => {
	const { tools } = await fixture();
	const result = json(
		await tools.execute(
			"exec_command",
			{ command: "sleep 30", yield_time_ms: 0 },
			context,
		),
	);
	await tools.processes.interruptAgents(["root"]);
	expect(
		json(
			await tools.execute(
				"process_output",
				{ process_id: result.process.id },
				context,
			),
		).process.status,
	).toBe("cancelled");
	const timed = json(
		await tools.execute(
			"exec_command",
			{ command: "sleep 30", timeout_ms: 100, yield_time_ms: 1000 },
			context,
		),
	);
	expect(timed.process.status).toBe("timed_out");
});
it("searches with fresh ripgrep and globs without shell interpolation", async () => {
	const { tools, cwd } = await fixture();
	await writeFile(join(cwd, "a.ts"), "needle\n");
	await writeFile(join(cwd, "b.txt"), "haystack\n");
	const grep = json(
		await tools.execute("grep", { pattern: "needle", literal: true }, context),
	);
	expect(grep.process.exitCode).toBe(0);
	expect(grep.text).toContain("a.ts:1:needle");
	const glob = json(await tools.execute("glob", { pattern: "*.ts" }, context));
	expect(glob.text).toContain("a.ts");
	expect(glob.text).not.toContain("b.txt");
});
