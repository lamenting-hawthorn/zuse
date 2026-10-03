import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { Schema } from "effect";
import { unzipSync } from "fflate";
import * as tar from "tar";
import snapshot from "./catalog-snapshot.json";

const Binary = Schema.Struct({
	archive: Schema.String,
	sha256: Schema.optional(Schema.String),
	cmd: Schema.String,
	args: Schema.optional(Schema.Array(Schema.String)),
	env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const Package = Schema.Struct({
	package: Schema.String,
	args: Schema.optional(Schema.Array(Schema.String)),
	env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export const Registry = Schema.Struct({
	version: Schema.String,
	agents: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			name: Schema.String,
			description: Schema.String,
			version: Schema.String,
			repository: Schema.optional(Schema.String),
			icon: Schema.optional(Schema.String),
			distribution: Schema.Struct({
				binary: Schema.optional(Schema.Record(Schema.String, Binary)),
				npx: Schema.optional(Package),
				uvx: Schema.optional(Package),
			}),
		}),
	),
});
export type Registry = typeof Registry.Type;
export type RegistryAgent = Registry["agents"][number];
const decode = Schema.decodeUnknownSync(Registry);
export const platformTarget = (
	platform = process.platform,
	arch = process.arch,
) =>
	`${platform === "win32" ? "windows" : platform}-${arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : arch}`;
export const distributionFor = (
	agent: RegistryAgent,
	target = platformTarget(),
) => {
	const binary = agent.distribution.binary?.[target];
	if (binary) return { kind: "binary" as const, value: binary };
	if (agent.distribution.npx)
		return { kind: "npx" as const, value: agent.distribution.npx };
	if (agent.distribution.uvx)
		return { kind: "uvx" as const, value: agent.distribution.uvx };
	return null;
};
export const readCatalog = async (
	directory: string,
	fetcher: typeof fetch = fetch,
): Promise<Registry> => {
	const file = join(directory, "catalog.json");
	let cached: Registry | undefined;
	try {
		cached = decode(JSON.parse(await readFile(file, "utf8")));
	} catch {
		/* Bundled fallback below. */
	}
	try {
		const response = await fetcher(
			"https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json",
			{ signal: AbortSignal.timeout(10_000) },
		);
		if (!response.ok) throw new Error(`Registry HTTP ${response.status}`);
		const registry = decode(await response.json());
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const temp = `${file}.${crypto.randomUUID()}.tmp`;
		await writeFile(temp, JSON.stringify(registry), { mode: 0o600 });
		await rename(temp, file);
		return registry;
	} catch {
		return cached ?? decode(snapshot);
	}
};
export const safeArchivePath = (root: string, entry: string) => {
	if (entry.includes("\\") || entry.includes("\0") || /^[a-z]:/i.test(entry))
		throw new Error("Unsafe archive path");
	const path = resolve(root, entry);
	if (path !== resolve(root) && !path.startsWith(resolve(root) + sep))
		throw new Error("Archive path escapes installation directory");
	return path;
};
const run = promisify(execFile);
export const installCatalogAgent = async (
	agent: RegistryAgent,
	directory: string,
	fetcher: typeof fetch = fetch,
	resolveExecutable: (name: string) => Promise<string> = async (name) => name,
) => {
	const distribution = distributionFor(agent);
	if (!distribution)
		throw new Error("This agent has no distribution for this host.");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const env = distribution.value.env ?? {};
	if (distribution.kind !== "binary") {
		const runnerName = distribution.kind === "npx" ? "npx" : "uvx";
		const runner = await resolveExecutable(runnerName);
		try {
			await run(runner, ["--version"], { timeout: 15_000 });
		} catch {
			throw new Error(
				`Install ${runnerName === "npx" ? "Node.js and npm" : "uv"} on this host first.`,
			);
		}
		const spec =
			distribution.kind === "uvx"
				? distribution.value.package.replace(/@(?=[^@]+$)/, "==")
				: distribution.value.package;
		// Registry packages are normally pinned; pin unversioned entries to the manifest version.
		const pinned =
			distribution.kind === "npx"
				? /@\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(spec)
					? spec
					: `${spec.replace(/@[^/]+$/, "")}@${agent.version}`
				: spec.includes("==")
					? spec
					: `${spec}==${agent.version}`;
		const cacheEnv: Record<string, string> =
			distribution.kind === "npx"
				? { npm_config_cache: join(directory, "npm-cache") }
				: { UV_CACHE_DIR: join(directory, "uv-cache") };
		const args =
			distribution.kind === "npx"
				? ["--yes", pinned, ...(distribution.value.args ?? [])]
				: [
						"--from",
						pinned,
						spec.split(/[=<>]/)[0] ?? spec,
						...(distribution.value.args ?? []),
					];
		return { command: runner, args, env: { ...env, ...cacheEnv } };
	}
	const source = distribution.value;
	const url = new URL(source.archive);
	if (url.protocol !== "https:")
		throw new Error("Agent downloads must use HTTPS");
	const response = await fetcher(url, { signal: AbortSignal.timeout(120_000) });
	if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
	const chunks: Uint8Array[] = [];
	let downloaded = 0;
	if (!response.body) throw new Error("Empty agent archive");
	const reader = response.body.getReader();
	while (true) {
		const { value: chunk, done } = await reader.read();
		if (done) break;
		downloaded += chunk.byteLength;
		if (downloaded > 512 * 1024 * 1024)
			throw new Error("Agent archive exceeds 512 MiB");
		chunks.push(chunk);
	}
	const bytes = Buffer.concat(chunks);
	if (
		source.sha256 &&
		createHash("sha256").update(bytes).digest("hex") !==
			source.sha256.toLowerCase()
	)
		throw new Error("Agent archive checksum mismatch");
	const archive = join(directory, "download");
	if (/\.zip$/i.test(url.pathname)) {
		let expanded = 0;
		const files = unzipSync(bytes, {
			filter: (entry) => {
				safeArchivePath(directory, entry.name);
				expanded += entry.originalSize;
				if (expanded > 1024 * 1024 * 1024)
					throw new Error("Expanded archive exceeds 1 GiB");
				return true;
			},
		});
		for (const [entry, data] of Object.entries(files)) {
			const target = safeArchivePath(directory, entry);
			if (entry.endsWith("/")) {
				await mkdir(target, { recursive: true });
				continue;
			}
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, data);
		}
	} else if (/\.(tar\.gz|tgz|tar|tar\.bz2|tbz2)$/i.test(url.pathname)) {
		await writeFile(archive, bytes);
		if (/\.(tar\.bz2|tbz2)$/i.test(url.pathname)) {
			const result = await run("bzip2", ["-dc", archive], {
				encoding: "buffer",
				maxBuffer: 1024 * 1024 * 1024,
				timeout: 60_000,
			});
			await writeFile(archive, result.stdout);
		}
		// Validate the complete archive before extracting any entry. Links are not allowed.
		let invalid: Error | undefined;
		let expanded = 0;
		await tar.t({
			file: archive,
			onReadEntry: (entry) => {
				try {
					safeArchivePath(directory, entry.path);
				} catch {
					invalid = new Error("Unsafe archive path");
				}
				expanded += entry.size;
				if (expanded > 1024 * 1024 * 1024)
					invalid = new Error("Expanded archive exceeds 1 GiB");
				if (
					![
						"File",
						"Directory",
						"OldFile",
						"ExtendedHeader",
						"GlobalExtendedHeader",
					].includes(entry.type)
				)
					invalid = new Error("Unsupported archive entry type");
			},
		});
		if (invalid) throw invalid;
		await tar.x({
			file: archive,
			cwd: directory,
			strict: true,
			preservePaths: false,
		});
	} else {
		await mkdir(dirname(safeArchivePath(directory, source.cmd)), {
			recursive: true,
		});
		await writeFile(safeArchivePath(directory, source.cmd), bytes);
	}
	const command = safeArchivePath(directory, source.cmd);
	await chmod(command, 0o700);
	return { command, args: [...(source.args ?? [])], env };
};
