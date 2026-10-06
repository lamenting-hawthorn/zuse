import { Data, Effect, type FileSystem, type Path } from "effect";
import { ensureMemoryDir } from "./context-files.ts";

/**
 * Per-project agent memory vault: a directory of Markdown notes under the
 * workspace's gitignored `.context/memory/`. `MEMORY.md` is the index — one
 * `- [[NN-<slug>]] — <title>` line per note — and each note is a standalone
 * `NN-<slug>.md` file. Notes are context, not instructions.
 *
 * Like `context-files.ts`, the ops take service *instances* so the
 * orchestration layer can bind `FileSystem` / `Path` captured at
 * layer-construction time. `cwd` resolves lazily per call so a session's
 * workspace is looked up when the tool fires, not when it is registered.
 */

export class MemoryVaultError extends Data.TaggedError("MemoryVaultError")<{
	readonly reason: string;
}> {}

export interface MemorySearchHit {
	readonly note: string;
	readonly line: number;
	readonly text: string;
}

export interface MemoryVault {
	readonly write: (input: {
		readonly title: string;
		readonly text: string;
	}) => Effect.Effect<{ readonly note: string }, MemoryVaultError>;
	readonly read: (input?: {
		readonly note?: string;
	}) => Effect.Effect<
		{ readonly note: string | null; readonly content: string },
		MemoryVaultError
	>;
	readonly search: (input: {
		readonly query: string;
	}) => Effect.Effect<
		{ readonly hits: ReadonlyArray<MemorySearchHit> },
		MemoryVaultError
	>;
}

const MEMORY_INDEX = "MEMORY.md";
const SEARCH_HIT_LIMIT = 50;

const EMPTY_INDEX = "# Memory Index\n\n(no notes yet)\n";
const INDEX_HEADER = "# Memory Index\n";

/** Notes are `NN-<slug>.md` — strict charset keeps names path-safe. */
const NOTE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const NOTE_FILE_PATTERN = /^(\d+)-([A-Za-z0-9_-]*)\.md$/;

const slugFor = (title: string): string => {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return slug.length > 0 ? slug : "note";
};

/**
 * Resolve a `note` argument to a filename without `.md`. Accepts an optional
 * trailing `.md`; anything else (`../x`, slashes, empty) is rejected.
 */
const safeNoteName = (raw: string): string | null => {
	const name = raw.endsWith(".md") ? raw.slice(0, -".md".length) : raw;
	return NOTE_NAME_PATTERN.test(name) ? name : null;
};

export const makeMemoryVault = (options: {
	readonly fs: FileSystem.FileSystem;
	readonly path: Path.Path;
	readonly cwd: Effect.Effect<string | null>;
}): MemoryVault => {
	const { fs, path: pathSvc } = options;

	const withDir = <A>(
		fn: (dir: string) => Effect.Effect<A, MemoryVaultError>,
	): Effect.Effect<A, MemoryVaultError> =>
		Effect.gen(function* () {
			const cwd = yield* options.cwd;
			if (cwd === null) {
				return yield* new MemoryVaultError({
					reason: "No workspace directory resolved for this session.",
				});
			}
			const dir = yield* ensureMemoryDir(fs, pathSvc, cwd);
			return yield* fn(dir);
		});

	const listNoteFiles = (dir: string) =>
		fs.readDirectory(dir).pipe(
			Effect.map((names) =>
				names.filter((name) => NOTE_FILE_PATTERN.test(name)).sort(),
			),
			Effect.mapError(
				(error) =>
					new MemoryVaultError({
						reason: `Could not list memory notes: ${String(error.reason ?? error)}`,
					}),
			),
		);

	const readFile = (path: string) =>
		fs.readFileString(path).pipe(
			Effect.mapError(
				(error) =>
					new MemoryVaultError({
						reason: `Could not read ${pathSvc.basename(path)}: ${String(error.reason ?? error)}`,
					}),
			),
		);

	const write = (input: {
		readonly title: string;
		readonly text: string;
	}): Effect.Effect<{ readonly note: string }, MemoryVaultError> =>
		withDir((dir) =>
			Effect.gen(function* () {
				const existing = yield* listNoteFiles(dir);
				const next =
					existing.reduce((max, name) => {
						const index = Number.parseInt(
							NOTE_FILE_PATTERN.exec(name)?.[1] ?? "",
							10,
						);
						return Number.isNaN(index) ? max : Math.max(max, index);
					}, 0) + 1;
				const note = `${String(next).padStart(2, "0")}-${slugFor(input.title)}`;
				yield* fs
					.writeFileString(
						pathSvc.join(dir, `${note}.md`),
						`# ${input.title}\n\n${input.text}\n`,
					)
					.pipe(
						Effect.mapError(
							(error) =>
								new MemoryVaultError({
									reason: `Could not write memory note: ${String(error.reason ?? error)}`,
								}),
						),
					);
				const indexPath = pathSvc.join(dir, MEMORY_INDEX);
				const index = (yield* fs
					.exists(indexPath)
					.pipe(Effect.orElseSucceed(() => false)))
					? yield* readFile(indexPath)
					: INDEX_HEADER;
				const entry = `- [[${note}]] — ${input.title}`;
				const body = index.endsWith("\n") ? index : `${index}\n`;
				yield* fs.writeFileString(indexPath, `${body}${entry}\n`).pipe(
					Effect.mapError(
						(error) =>
							new MemoryVaultError({
								reason: `Could not update ${MEMORY_INDEX}: ${String(error.reason ?? error)}`,
							}),
					),
				);
				return { note };
			}),
		);

	const read = (input?: {
		readonly note?: string;
	}): Effect.Effect<
		{ readonly note: string | null; readonly content: string },
		MemoryVaultError
	> =>
		withDir((dir) =>
			Effect.gen(function* () {
				if (input?.note === undefined) {
					const indexPath = pathSvc.join(dir, MEMORY_INDEX);
					const content = (yield* fs
						.exists(indexPath)
						.pipe(Effect.orElseSucceed(() => false)))
						? yield* readFile(indexPath)
						: EMPTY_INDEX;
					return { note: null, content };
				}
				const name = safeNoteName(input.note);
				if (name === null) {
					return yield* new MemoryVaultError({
						reason: `Invalid note name: ${input.note}`,
					});
				}
				const notePath = pathSvc.join(dir, `${name}.md`);
				if (
					!(yield* fs.exists(notePath).pipe(Effect.orElseSucceed(() => false)))
				) {
					return yield* new MemoryVaultError({
						reason: `No memory note named ${input.note}.`,
					});
				}
				return { note: name, content: yield* readFile(notePath) };
			}),
		);

	const search = (input: {
		readonly query: string;
	}): Effect.Effect<
		{ readonly hits: ReadonlyArray<MemorySearchHit> },
		MemoryVaultError
	> =>
		withDir((dir) =>
			Effect.gen(function* () {
				const query = input.query.trim().toLowerCase();
				if (query.length === 0) {
					return yield* new MemoryVaultError({
						reason: "memory_search requires a non-empty query.",
					});
				}
				const names = (yield* fs
					.readDirectory(dir)
					.pipe(
						Effect.orElseSucceed(() => [] as ReadonlyArray<string>),
					)).filter((name) => name.endsWith(".md"));
				const hits: MemorySearchHit[] = [];
				for (const name of names) {
					if (hits.length >= SEARCH_HIT_LIMIT) break;
					const content = yield* fs
						.readFileString(pathSvc.join(dir, name))
						.pipe(Effect.orElseSucceed(() => ""));
					const note = name.slice(0, -".md".length);
					const lines = content.split("\n");
					for (const [index, line] of lines.entries()) {
						if (hits.length >= SEARCH_HIT_LIMIT) break;
						if (line.toLowerCase().includes(query)) {
							hits.push({ note, line: index + 1, text: line.trim() });
						}
					}
				}
				return { hits };
			}),
		);

	return { write, read, search };
};
