import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ATTACHMENT_CHUNK_BYTES,
	type AttachmentUploadChunk,
	MAX_ATTACHMENT_BYTES,
} from "@zuse/contracts";

const MAX_ACTIVE_UPLOADS = 16;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

type PendingUpload = {
	readonly path: string;
	readonly metadata: string;
	offset: number;
	updatedAt: number;
	busy: boolean;
};

/** Disposable staging only: existing attachment storage publishes complete files. */
export class AttachmentUploadChunks {
	private readonly pending = new Map<string, PendingUpload>();
	private readonly operations = new Set<Promise<unknown>>();
	private readonly timer: ReturnType<typeof setInterval>;
	private closed = false;

	private constructor(private readonly directory: string) {
		this.timer = setInterval(() => {
			void this.expire().catch((cause) => {
				console.warn("[attachments] Could not remove expired upload", cause);
			});
		}, 60_000);
		this.timer.unref();
	}

	static async create(): Promise<AttachmentUploadChunks> {
		return new AttachmentUploadChunks(
			await mkdtemp(join(tmpdir(), "zuse-upload-")),
		);
	}

	private track<A>(operation: Promise<A>): Promise<A> {
		this.operations.add(operation);
		return operation.finally(() => this.operations.delete(operation));
	}

	async close(): Promise<void> {
		this.closed = true;
		clearInterval(this.timer);
		await Promise.allSettled(this.operations);
		this.pending.clear();
		await rm(this.directory, { recursive: true, force: true });
	}

	expire(now = Date.now()): Promise<void> {
		return this.track(
			(async () => {
				for (const [key, entry] of this.pending) {
					if (!entry.busy && now - entry.updatedAt >= IDLE_TIMEOUT_MS) {
						this.pending.delete(key);
						await rm(entry.path, { force: true });
					}
				}
			})(),
		);
	}

	accept(input: AttachmentUploadChunk): Promise<Uint8Array | null> {
		return this.track(this.acceptChunk(input));
	}

	private async acceptChunk(
		input: AttachmentUploadChunk,
	): Promise<Uint8Array | null> {
		if (this.closed)
			throw new Error(
				"Upload service is closed. Please attach the file again.",
			);
		if (
			!input.uploadId ||
			input.uploadId.length > 128 ||
			!Number.isSafeInteger(input.offset) ||
			input.offset < 0 ||
			!Number.isSafeInteger(input.totalBytes) ||
			input.totalBytes <= 0 ||
			input.totalBytes > MAX_ATTACHMENT_BYTES ||
			input.bytes.byteLength === 0 ||
			input.bytes.byteLength > ATTACHMENT_CHUNK_BYTES ||
			input.offset + input.bytes.byteLength > input.totalBytes
		)
			throw new Error("Invalid file upload chunk.");

		const key = JSON.stringify([input.sessionId, input.uploadId]);
		const metadata = JSON.stringify([
			input.totalBytes,
			input.mimeType,
			input.originalName,
			input.rootPath ?? null,
		]);
		let entry = this.pending.get(key);
		if (entry === undefined) {
			if (input.offset !== 0)
				throw new Error(
					"Upload expired or was interrupted. Please attach the file again.",
				);
			if (this.pending.size >= MAX_ACTIVE_UPLOADS)
				throw new Error("Too many file uploads. Please try again later.");
			entry = {
				path: join(this.directory, randomUUID()),
				metadata,
				offset: 0,
				updatedAt: Date.now(),
				busy: false,
			};
			this.pending.set(key, entry);
		}
		if (
			entry.busy ||
			entry.offset !== input.offset ||
			entry.metadata !== metadata
		) {
			throw new Error(
				"File upload chunks arrived out of order or changed. Please attach the file again.",
			);
		}
		entry.busy = true;
		try {
			await appendFile(entry.path, input.bytes, { mode: 0o600 });
			entry.offset += input.bytes.byteLength;
			entry.updatedAt = Date.now();
			if (entry.offset !== input.totalBytes) return null;
			const bytes = await readFile(entry.path);
			await rm(entry.path, { force: true });
			this.pending.delete(key);
			return bytes;
		} catch (cause) {
			this.pending.delete(key);
			await rm(entry.path, { force: true });
			throw cause;
		} finally {
			entry.busy = false;
		}
	}
}
