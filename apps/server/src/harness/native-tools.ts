import { isUtf8 } from "node:buffer";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	link,
	mkdir,
	open,
	readdir,
	realpath,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { digest } from "@zuse/agents/harness/cache";
import {
	nativeToolDefinitions,
	nativeToolSchemas,
} from "@zuse/agents/harness/native-tool-definitions";
import type {
	HarnessToolContext,
	HarnessToolOutput,
} from "@zuse/agents/harness/types";
import { imageMime, isWithin } from "@zuse/agents/kernel/file-validation";
import {
	decidePermission,
	isSensitivePath,
	type RuntimeMode,
} from "@zuse/agents/kernel/permission-policy";
import { withProcessLock } from "../process/process-lock.ts";
import { HarnessProcesses, type ProcessOptions } from "./processes.ts";

const MAX_FILE = 2 * 1024 * 1024;

export interface NativeToolOptions extends ProcessOptions {
	readonly cwd: string;
	readonly lockDirectory: string;
	readonly runtimeMode: () => RuntimeMode;
	readonly approve?: (
		request: { name: string; input: unknown; path?: string },
		context: HarnessToolContext,
	) => Promise<boolean>;
	readonly question?: (
		input: { question: string; options?: string[] },
		context: HarnessToolContext,
	) => Promise<string>;
	readonly plan?: (
		steps: Array<{
			step: string;
			status: "pending" | "in_progress" | "completed";
		}>,
		context: HarnessToolContext,
	) => Promise<void>;
	readonly ripgrep?: string;
}
/** Local tools share one permission policy and one process owner per root conversation. */
export class NativeHarnessTools {
	readonly processes: HarnessProcesses;
	readonly definitions;
	private root = "";
	constructor(private readonly options: NativeToolOptions) {
		this.processes = new HarnessProcesses(options);
		this.definitions = nativeToolDefinitions(
			Boolean(options.question),
			Boolean(options.plan),
		);
	}
	async initialize(): Promise<void> {
		this.root = await realpath(this.options.cwd);
		await mkdir(this.options.lockDirectory, { recursive: true, mode: 0o700 });
		await this.processes.initialize();
	}
	private inside(path: string): void {
		if (!isWithin(path, this.root))
			throw new Error("Path is outside the checkout");
	}
	private async path(input: string): Promise<string> {
		const absolute = resolve(this.root, input);
		this.inside(absolute);
		let current = absolute;
		const missing: string[] = [];
		for (;;) {
			try {
				const canonical = await realpath(current);
				this.inside(canonical);
				return resolve(canonical, ...missing.reverse());
			} catch (error) {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT"
					)
				)
					throw error;
			}
			const parent = dirname(current);
			if (parent === current) throw new Error("Cannot resolve path");
			missing.push(relative(parent, current));
			current = parent;
		}
	}
	private async read(
		path: string,
		text = true,
	): Promise<{ data: Buffer; mode: number }> {
		const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const stat = await file.stat();
			if (!stat.isFile() || stat.size > MAX_FILE)
				throw new Error("Expected a regular file no larger than 2 MiB");
			const buffer = Buffer.alloc(
				Math.min(MAX_FILE + 1, Math.max(4096, stat.size + 1)),
			);
			let size = 0;
			while (size < buffer.length) {
				const result = await file.read(
					buffer,
					size,
					buffer.length - size,
					size,
				);
				if (!result.bytesRead) break;
				size += result.bytesRead;
			}
			if (size > MAX_FILE) throw new Error("File exceeds 2 MiB");
			if (size === buffer.length)
				throw new Error("File grew during read; retry");
			const data = buffer.subarray(0, size);
			if (text && (!isUtf8(data) || data.includes(0)))
				throw new Error("Expected a UTF-8 text file");
			return { data, mode: stat.mode & 0o777 };
		} finally {
			await file.close();
		}
	}
	private async bounded(value: unknown): Promise<string> {
		const full = JSON.stringify(value);
		if (Buffer.byteLength(full) <= 32_000) return full;
		const artifact = join(
			this.options.directory,
			`${randomUUID()}.result.json`,
		);
		await writeFile(artifact, full, { flag: "wx", mode: 0o600 });
		return JSON.stringify({
			preview: full.slice(0, 12_000),
			truncated: true,
			artifact,
		});
	}
	private replace(
		content: string,
		edit: { old_string: string; new_string: string; replace_all: boolean },
	): string {
		const first = content.indexOf(edit.old_string);
		if (first < 0) throw new Error("Edit text was not found");
		if (!edit.replace_all && content.indexOf(edit.old_string, first + 1) >= 0)
			throw new Error("Ambiguous edit; use replace_all or more context");
		return edit.replace_all
			? content.split(edit.old_string).join(edit.new_string)
			: content.slice(0, first) +
					edit.new_string +
					content.slice(first + edit.old_string.length);
	}
	private async change(
		path: string,
		expected: string | null,
		transform: (current: string) => string,
		context: HarnessToolContext,
	): Promise<string> {
		return withProcessLock(
			join(this.options.lockDirectory, `${digest(path)}.sqlite`),
			async () => {
				if ((await this.path(path)) !== path)
					throw new Error("Path changed before edit");
				const previous = expected === null ? null : await this.read(path);
				if (previous && digest(previous.data) !== expected)
					throw new Error("Stale file hash; read the file again");
				const next = transform(previous?.data.toString("utf8") ?? "");
				if (Buffer.byteLength(next) > MAX_FILE)
					throw new Error("Edited file exceeds 2 MiB");
				context.signal.throwIfAborted();
				await mkdir(dirname(path), { recursive: true });
				if ((await this.path(path)) !== path)
					throw new Error("Path changed before edit");

				const temporary = join(dirname(path), `.zuse-${randomUUID()}.tmp`);
				try {
					const file = await open(temporary, "wx", previous?.mode ?? 0o644);
					try {
						await file.writeFile(next);
						if (previous) await file.chmod(previous.mode);
						await file.sync();
					} finally {
						await file.close();
					}
					context.signal.throwIfAborted();
					if (expected === null) await link(temporary, path);
					else {
						if (digest((await this.read(path)).data) !== expected)
							throw new Error("File changed during edit");
						await rename(temporary, path);
					}
				} finally {
					await unlink(temporary).catch(() => {});
				}

				return JSON.stringify({
					path,
					hash: digest(next),
					bytes: Buffer.byteLength(next),
				});
			},
			context.signal,
		);
	}
	async execute(
		name: string,
		input: unknown,
		context: HarnessToolContext,
	): Promise<HarnessToolOutput> {
		context.signal.throwIfAborted();
		const definition = this.definitions[name];
		if (!definition) throw new Error("Unknown native tool");
		const pathInput =
			typeof input === "object" && input !== null
				? (Reflect.get(input, "path") ?? Reflect.get(input, "cwd"))
				: undefined;
		const path =
			typeof pathInput === "string" ? await this.path(pathInput) : undefined;
		const verdict = decidePermission({
			runtimeMode: this.options.runtimeMode(),
			permissionMode: context.readOnly ? "plan" : context.permissionMode,
			category: definition.category,
			sensitive: path !== undefined && isSensitivePath(path),
			canPrompt: Boolean(this.options.approve),
		});
		if (
			verdict === "deny" ||
			(verdict === "prompt" &&
				!(await this.options.approve?.({ name, input, path }, context)))
		)
			throw new Error("Tool permission denied");
		context.signal.throwIfAborted();
		switch (name) {
			case "read_image": {
				const args = nativeToolSchemas.read_image.parse(input);
				const { data } = await this.read(await this.path(args.path), false);
				const mediaType = imageMime(data);
				if (!mediaType) throw new Error("Unsupported image format");
				return {
					type: "content",
					value: [
						{
							type: "file",
							mediaType,
							data: { type: "data", data: data.toString("base64") },
						},
					],
				};
			}
			case "read_file": {
				const args = nativeToolSchemas.read_file.parse(input);
				const file = await this.path(args.path);
				const { data } = await this.read(file);
				const lines = data.toString("utf8").split("\n");
				const selected = lines
					.slice(args.offset, args.offset + args.limit)
					.join("\n");
				return this.bounded({
					path: file,
					hash: digest(data),
					total_lines: lines.length,
					offset: args.offset,
					content: selected,
					has_more: args.offset + args.limit < lines.length,
				});
			}
			case "list_directory": {
				const args = nativeToolSchemas.list_directory.parse(input);
				const entries = await readdir(await this.path(args.path), {
					withFileTypes: true,
				});
				return this.bounded(
					entries
						.sort((a, b) => a.name.localeCompare(b.name))
						.map((e) => ({
							name: e.name,
							type: e.isSymbolicLink()
								? "symlink"
								: e.isDirectory()
									? "directory"
									: "file",
						})),
				);
			}
			case "write_file": {
				const args = nativeToolSchemas.write_file.parse(input);
				return this.change(
					await this.path(args.path),
					args.expected_hash,
					() => args.content,
					context,
				);
			}
			case "edit_file": {
				const args = nativeToolSchemas.edit_file.parse(input);
				return this.change(
					await this.path(args.path),
					args.expected_hash,
					(current) => this.replace(current, args),
					context,
				);
			}
			case "multi_edit": {
				const args = nativeToolSchemas.multi_edit.parse(input);
				return this.change(
					await this.path(args.path),
					args.expected_hash,
					(current) =>
						args.edits.reduce(
							(text, edit) => this.replace(text, edit),
							current,
						),
					context,
				);
			}
			case "exec_command": {
				const args = nativeToolSchemas.exec_command.parse(input);
				const process = await this.processes.start({
					agentId: context.agentId,
					file: "/bin/bash",
					args: ["-lc", args.command],
					cwd: await this.path(args.cwd),
					label: args.label ?? "Bash command",
					timeoutMs: args.timeout_ms,
					notifyOnOutput: args.notify_on_output,
					signal: context.signal,
				});
				await this.processes.wait(
					process.id,
					context.agentId,
					args.yield_time_ms,
					context.signal,
				);
				return JSON.stringify(
					await this.processes.output(process.id, context.agentId),
				);
			}
			case "grep":
			case "glob": {
				const args =
					name === "grep"
						? nativeToolSchemas.grep.parse(input)
						: nativeToolSchemas.glob.parse(input);
				const argv =
					name === "glob"
						? ["--files", "--glob", args.pattern]
						: [
								"--line-number",
								"--no-heading",
								"--color",
								"never",
								"--max-columns",
								"1000",
								...("literal" in args && args.literal
									? ["--fixed-strings"]
									: []),
								...("ignore_case" in args && args.ignore_case
									? ["--ignore-case"]
									: []),
								...("glob" in args && typeof args.glob === "string"
									? ["--glob", args.glob]
									: []),
								"--",
								args.pattern,
								".",
							];
				const process = await this.processes.start({
					agentId: context.agentId,
					file: this.options.ripgrep ?? "rg",
					args: argv,
					cwd: await this.path(args.path),
					label: name,
					timeoutMs: 30_000,
					signal: context.signal,
					notify: false,
				});
				await this.processes.wait(
					process.id,
					context.agentId,
					30_000,
					context.signal,
				);
				return JSON.stringify(
					await this.processes.output(process.id, context.agentId),
				);
			}
			case "process_output": {
				const args = nativeToolSchemas.process_output.parse(input);
				return JSON.stringify(
					await this.processes.output(
						args.process_id,
						context.agentId,
						args.cursor,
						args.max_bytes,
					),
				);
			}
			case "wait_process": {
				const args = nativeToolSchemas.wait_process.parse(input);
				await this.processes.wait(
					args.process_id,
					context.agentId,
					args.timeout_ms,
					context.signal,
				);
				return JSON.stringify(
					await this.processes.output(args.process_id, context.agentId),
				);
			}
			case "write_stdin": {
				const args = nativeToolSchemas.write_stdin.parse(input);
				await this.processes.write(
					args.process_id,
					context.agentId,
					args.data,
					args.eof,
					context.signal,
				);
				return "Input sent";
			}
			case "stop_process": {
				const args = nativeToolSchemas.stop_process.parse(input);
				await this.processes.stop(args.process_id, context.agentId);
				return "Process stopped";
			}
			case "list_processes":
				nativeToolSchemas.list_processes.parse(input);
				return this.bounded(this.processes.list(context.agentId));
			case "update_plan": {
				const args = nativeToolSchemas.update_plan.parse(input);
				if (args.steps.filter((s) => s.status === "in_progress").length > 1)
					throw new Error("Only one plan step can be in progress");
				await this.options.plan?.(args.steps, context);
				return "Plan updated";
			}
			case "request_user_input": {
				const args = nativeToolSchemas.request_user_input.parse(input);
				if (!this.options.question)
					throw new Error("Questions are unavailable");
				return this.options.question(args, context);
			}
			default:
				throw new Error("Unknown native tool");
		}
	}
	async close(): Promise<void> {
		await this.processes.close();
	}
}
