import { z } from "zod";
import type { HarnessTool } from "./types.ts";

const path = z.string().min(1).max(4096);
const text = z.string().max(2 * 1024 * 1024);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const edit = z.object({
	old_string: text.min(1),
	new_string: text,
	replace_all: z.boolean().default(false),
});
const processId = z.string().uuid();
/** Schemas validate local execution and generate model definitions from one source. */
export const nativeToolSchemas = {
	read_file: z.object({
		path,
		offset: z.number().int().nonnegative().default(0),
		limit: z.number().int().min(1).max(2000).default(400),
	}),
	read_image: z.object({ path }),
	list_directory: z.object({ path: path.default(".") }),
	glob: z.object({
		pattern: z.string().min(1).max(512),
		path: path.default("."),
	}),
	grep: z.object({
		pattern: z.string().min(1).max(4096),
		path: path.default("."),
		literal: z.boolean().default(false),
		ignore_case: z.boolean().default(false),
		glob: z.string().max(512).optional(),
	}),
	write_file: z.object({
		path,
		content: text,
		expected_hash: hash
			.nullable()
			.describe(
				"Current hash from read_file; null creates a new file exclusively.",
			),
	}),
	edit_file: z.object({ path, expected_hash: hash, ...edit.shape }),
	multi_edit: z.object({
		path,
		expected_hash: hash,
		edits: z.array(edit).min(1).max(100),
	}),
	exec_command: z.object({
		command: z.string().min(1).max(64_000),
		cwd: path.default("."),
		label: z.string().max(120).optional(),
		yield_time_ms: z.number().int().min(0).max(30_000).default(1000),
		timeout_ms: z
			.number()
			.int()
			.min(100)
			.max(24 * 60 * 60_000)
			.default(30 * 60_000),
		notify_on_output: z.string().min(1).max(256).optional(),
	}),
	process_output: z.object({
		process_id: processId,
		cursor: z.number().int().nonnegative().default(0),
		max_bytes: z.number().int().min(1).max(64_000).default(16_000),
	}),
	write_stdin: z.object({
		process_id: processId,
		data: z.string().max(64_000).default(""),
		eof: z.boolean().default(false),
	}),
	wait_process: z.object({
		process_id: processId,
		timeout_ms: z.number().int().min(0).max(30_000).default(1000),
	}),
	list_processes: z.object({}),
	stop_process: z.object({ process_id: processId }),
	update_plan: z.object({
		steps: z
			.array(
				z.object({
					step: z.string().min(1).max(500),
					status: z.enum(["pending", "in_progress", "completed"]),
				}),
			)
			.max(30),
	}),
	request_user_input: z.object({
		question: z.string().min(1).max(2000),
		options: z.array(z.string().min(1).max(300)).min(2).max(5).optional(),
	}),
};
export type NativeToolName = keyof typeof nativeToolSchemas;
const descriptions: Record<
	NativeToolName,
	{ description: string; category: HarnessTool["category"] }
> = {
	read_file: {
		category: "read",
		description:
			"Read fresh UTF-8 file lines and SHA-256. Offsets are zero-based. Keep the returned hash for edits; large output is an artifact.",
	},
	read_image: {
		category: "read",
		description: "Read a local PNG, JPEG, GIF, or WebP as image content.",
	},
	list_directory: {
		category: "read",
		description: "List immediate directory entries, including hidden names.",
	},
	glob: {
		category: "read",
		description:
			"Find files by ripgrep glob in the checkout. Honors ignore rules; excludes symlink traversal.",
	},
	grep: {
		category: "read",
		description:
			"Search fresh file content with ripgrep (regex or literal), with file names and line numbers. Honors ignore rules.",
	},
	write_file: {
		category: "edit",
		description:
			"Create or replace a UTF-8 file. null expected_hash means create only; replacement requires the hash from read_file.",
	},
	edit_file: {
		category: "edit",
		description:
			"Apply a literal replacement against the expected file hash. Ambiguous matches require explicit replace_all.",
	},
	multi_edit: {
		category: "edit",
		description:
			"Apply ordered literal replacements to ONE file atomically. Every edit must validate before any content is written. Use current expected_hash.",
	},
	exec_command: {
		category: "execute",
		description:
			"Run Bash in the checkout with supervised background execution. Returns a process_id if still running after yield_time_ms. Full output is saved locally. Completion and optional literal output-match notifications go to this conversation automatically.",
	},
	process_output: {
		category: "read",
		description:
			"Read bounded process output from a byte cursor. Use next_cursor to avoid rereading output; includes status and artifact location.",
	},
	write_stdin: {
		category: "execute",
		description:
			"Send input to a managed process; eof closes its stdin. Pipes, not a PTY. Control characters are data; use stop_process to terminate.",
	},
	wait_process: {
		category: "read",
		description:
			"Wait at most 30 seconds for a managed process, then return its status and output. Does not start another command.",
	},
	list_processes: {
		category: "read",
		description:
			"List this agent's managed processes; the root may inspect all child processes.",
	},
	stop_process: {
		category: "execute",
		description:
			"Terminate a managed command and its descendant process group.",
	},
	update_plan: {
		category: "read",
		description:
			"Update the visible work plan. At most one step can be in progress.",
	},
	request_user_input: {
		category: "read",
		description: "Ask the user a question and wait for their answer.",
	},
};
export function nativeToolDefinitions(
	questions = false,
	plans = false,
): Readonly<Record<string, HarnessTool>> {
	return Object.fromEntries(
		Object.entries(nativeToolSchemas)
			.filter(
				([name]) =>
					(questions || name !== "request_user_input") &&
					(plans || name !== "update_plan"),
			)
			.map(([name, schema]) => [
				name,
				{
					...descriptions[name as NativeToolName],
					parameters: z.toJSONSchema(schema),
				},
			]),
	);
}
