import { createHash } from "node:crypto";

/** Canonical JSON is used only for immutable definitions, never to reorder history. */
export function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}
export const digest = (value: string): string =>
	createHash("sha256").update(value).digest("hex");
export const promptCacheKey = (
	connection: string,
	model: string,
	root: string,
): string => digest(stableJson(["zuse-harness-v1", connection, model, root]));

/** One budget across serialized prompts, parsed instructions, schemas and estimates. */
export class HarnessCache {
	private entries = new Map<string, { value: string; bytes: number }>();
	private bytes = 0;
	readonly stats = { hits: 0, misses: 0, evictions: 0 };
	constructor(
		readonly maxBytes = 64 * 1024 * 1024,
		readonly maxEntries = 4096,
	) {}
	get(key: string): string | undefined {
		const entry = this.entries.get(key);
		if (!entry) {
			this.stats.misses++;
			return undefined;
		}
		this.stats.hits++;
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value;
	}
	set(key: string, value: string): void {
		const old = this.entries.get(key);
		if (old) {
			this.bytes -= old.bytes;
			this.entries.delete(key);
		}
		const bytes = Buffer.byteLength(key) + Buffer.byteLength(value);
		if (bytes > this.maxBytes || this.maxEntries < 1) return;
		this.entries.set(key, { value, bytes });
		this.bytes += bytes;
		while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
			const key = this.entries.keys().next().value;
			if (key === undefined) break;
			this.bytes -= this.entries.get(key)?.bytes ?? 0;
			this.entries.delete(key);
			this.stats.evictions++;
		}
	}
	clear(): void {
		this.entries.clear();
		this.bytes = 0;
	}
	get retainedBytes(): number {
		return this.bytes;
	}
	get size(): number {
		return this.entries.size;
	}
}
