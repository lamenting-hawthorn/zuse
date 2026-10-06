import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
	type MemoryVault,
	makeMemoryVault,
} from "../../src/context/memory-vault.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

const fixture = (): string => {
	const directory = mkdtempSync(join(tmpdir(), "zuse-memory-vault-"));
	temporaryDirectories.push(directory);
	return directory;
};

const memoryDir = (cwd: string): string => join(cwd, ".context", "memory");

const withVault = <A>(
	cwd: string | null,
	fn: (vault: MemoryVault) => Effect.Effect<A, unknown>,
) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const pathSvc = yield* Path.Path;
		const vault = makeMemoryVault({
			fs,
			path: pathSvc,
			cwd: Effect.succeed(cwd),
		});
		return yield* fn(vault);
	}).pipe(Effect.provide(NodeServices.layer));

describe("memory vault", () => {
	it("writes a note file and indexes it in MEMORY.md", async () => {
		const cwd = fixture();
		const written = await Effect.runPromise(
			withVault(cwd, (vault) =>
				vault.write({
					title: "Build uses bun",
					text: "Run `bun install` before anything else.",
				}),
			),
		);
		expect(written.note).toBe("01-build-uses-bun");
		expect(
			readFileSync(join(memoryDir(cwd), "01-build-uses-bun.md"), "utf8"),
		).toBe("# Build uses bun\n\nRun `bun install` before anything else.\n");
		const index = readFileSync(join(memoryDir(cwd), "MEMORY.md"), "utf8");
		expect(index).toContain("# Memory Index");
		expect(index).toContain("- [[01-build-uses-bun]] — Build uses bun");
	});

	it("auto-creates .context/memory and increments the note index", async () => {
		const cwd = fixture();
		const [first, second] = await Effect.runPromise(
			withVault(cwd, (vault) =>
				Effect.gen(function* () {
					const first = yield* vault.write({ title: "One", text: "a" });
					const second = yield* vault.write({ title: "Two", text: "b" });
					return [first, second];
				}),
			),
		);
		expect(first.note).toBe("01-one");
		expect(second.note).toBe("02-two");
		const index = readFileSync(join(memoryDir(cwd), "MEMORY.md"), "utf8");
		expect(index).toContain("- [[01-one]] — One");
		expect(index).toContain("- [[02-two]] — Two");
	});

	it("reads the index by default and a note by name", async () => {
		const cwd = fixture();
		const [index, note] = await Effect.runPromise(
			withVault(cwd, (vault) =>
				Effect.gen(function* () {
					yield* vault.write({ title: "Deploy", text: "Ship via CI." });
					return [
						yield* vault.read(),
						yield* vault.read({ note: "01-deploy" }),
					];
				}),
			),
		);
		expect(index.note).toBeNull();
		expect(index.content).toContain("- [[01-deploy]] — Deploy");
		expect(note.note).toBe("01-deploy");
		expect(note.content).toContain("Ship via CI.");
	});

	it("finds note content with a case-insensitive substring search", async () => {
		const cwd = fixture();
		const hits = await Effect.runPromise(
			withVault(cwd, (vault) =>
				Effect.gen(function* () {
					yield* vault.write({
						title: "Database",
						text: "Postgres runs on port 5432.",
					});
					yield* vault.write({ title: "Frontend", text: "React + Vite." });
					return yield* vault.search({ query: "postgres" });
				}),
			),
		);
		expect(hits.hits).toEqual([
			{ note: "01-database", line: 3, text: "Postgres runs on port 5432." },
		]);
	});

	it("reports an empty index and no hits on a fresh vault", async () => {
		const cwd = fixture();
		const [index, hits] = await Effect.runPromise(
			withVault(cwd, (vault) =>
				Effect.gen(function* () {
					return [
						yield* vault.read(),
						yield* vault.search({ query: "anything" }),
					];
				}),
			),
		);
		expect(index.note).toBeNull();
		expect(index.content).toContain("no notes yet");
		expect(hits.hits).toEqual([]);
	});

	it("rejects path-unsafe note names", async () => {
		const cwd = fixture();
		const error = await Effect.runPromise(
			withVault(cwd, (vault) =>
				vault.read({ note: "../secret" }).pipe(Effect.flip),
			),
		);
		expect(error.reason).toContain("Invalid note name");
	});

	it("fails cleanly when no workspace cwd resolves", async () => {
		const error = await Effect.runPromise(
			withVault(null, (vault) =>
				vault.write({ title: "x", text: "y" }).pipe(Effect.flip),
			),
		);
		expect(error.reason).toContain("No workspace directory");
	});
});
