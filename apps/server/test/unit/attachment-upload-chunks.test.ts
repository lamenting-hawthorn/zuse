import { randomBytes } from "node:crypto";
import { AttachmentService } from "@zuse/agents/kernel/attachment-service";
import { uploadAttachmentInChunks } from "@zuse/client-runtime/attachment-upload";
import {
	ATTACHMENT_CHUNK_BYTES,
	AttachmentUploadChunk,
	AttachmentUploadChunkRpc,
	decodeWorkspaceGatewayFrame,
	encodeWorkspaceGatewayFrame,
	MAX_ATTACHMENT_BYTES,
	SessionId,
} from "@zuse/contracts";
import { Effect, Layer, Schema } from "effect";
import { RpcGroup, RpcTest } from "effect/unstable/rpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentHandlersLayer } from "../../src/attachment/handlers.ts";
import { AttachmentUploadChunks } from "../../src/attachment/upload-chunks.ts";

const sessionId = SessionId.make("cloud-zip");
const chunk = (
	overrides: Partial<AttachmentUploadChunk> = {},
): AttachmentUploadChunk => ({
	sessionId,
	uploadId: "upload",
	mimeType: "application/zip",
	originalName: "archive.zip",
	bytes: new Uint8Array([80, 75]),
	totalBytes: 4,
	offset: 0,
	...overrides,
});

describe("attachment staging", () => {
	let uploads: AttachmentUploadChunks;
	beforeEach(async () => {
		uploads = await AttachmentUploadChunks.create();
	});
	afterEach(async () => {
		await uploads.close();
	});

	it("rejects missing, duplicate, concurrent and changed chunks without corrupting the upload", async () => {
		await expect(uploads.accept(chunk({ offset: 2 }))).rejects.toThrow(
			"expired",
		);
		const first = uploads.accept(chunk());
		await expect(uploads.accept(chunk())).rejects.toThrow("out of order");
		expect(await first).toBeNull();
		await expect(uploads.accept(chunk())).rejects.toThrow("out of order");
		await expect(
			uploads.accept(chunk({ offset: 2, originalName: "other.zip" })),
		).rejects.toThrow("changed");
		await expect(
			uploads.accept(chunk({ offset: 2, totalBytes: 6 })),
		).rejects.toThrow("changed");
		expect(
			await uploads.accept(chunk({ offset: 2, bytes: new Uint8Array([3, 4]) })),
		).toEqual(Buffer.from([80, 75, 3, 4]));
	});

	it("isolates identical upload IDs by session", async () => {
		await uploads.accept(chunk());
		await expect(
			uploads.accept(chunk({ sessionId: SessionId.make("other"), offset: 2 })),
		).rejects.toThrow("expired");
		expect(await uploads.accept(chunk({ offset: 2 }))).toEqual(
			Buffer.from([80, 75, 80, 75]),
		);
	});

	it("expires abandoned uploads and rejects continuation after service restart", async () => {
		await uploads.accept(chunk());
		await uploads.expire(Date.now() + 11 * 60 * 1000);
		await expect(uploads.accept(chunk({ offset: 2 }))).rejects.toThrow(
			"expired",
		);
		await uploads.accept(chunk());
		await uploads.close();
		await expect(uploads.accept(chunk({ offset: 2 }))).rejects.toThrow(
			"closed",
		);
		uploads = await AttachmentUploadChunks.create();
		await expect(uploads.accept(chunk({ offset: 2 }))).rejects.toThrow(
			"expired",
		);
	});

	it("bounds chunk size, total size and concurrent staging", async () => {
		for (const invalid of [
			{ totalBytes: MAX_ATTACHMENT_BYTES + 1 },
			{ offset: -1 },
			{ offset: 0.5 },
			{ totalBytes: 1 },
			{ totalBytes: Infinity },
			{ bytes: new Uint8Array() },
			{
				bytes: new Uint8Array(ATTACHMENT_CHUNK_BYTES + 1),
				totalBytes: MAX_ATTACHMENT_BYTES,
			},
		])
			await expect(uploads.accept(chunk(invalid))).rejects.toThrow("Invalid");
		for (let i = 0; i < 16; i++)
			await uploads.accept(chunk({ uploadId: String(i) }));
		await expect(
			uploads.accept(chunk({ uploadId: "overflow" })),
		).rejects.toThrow("Too many");
		await uploads.expire(Date.now() + 11 * 60 * 1000);
		expect(await uploads.accept(chunk({ uploadId: "next" }))).toBeNull();
	});
});

it("uploads a 7 MiB ZIP through gateway framing and RPC, publishing the exact bytes only once", async () => {
	const bytes = randomBytes(7 * 1024 * 1024);
	bytes.set([80, 75, 3, 4]);
	const upload = vi.fn((_session: SessionId, received: Uint8Array) => {
		expect(Buffer.compare(bytes, received)).toBe(0);
		return Effect.succeed({
			id: "stored-zip",
			sizeBytes: received.length,
			mimeType: "application/zip",
			ext: "zip",
		});
	});
	const services = AttachmentHandlersLayer.pipe(
		Layer.provide(
			Layer.succeed(AttachmentService, {
				upload,
				saveText: () => Effect.die("unused"),
				read: () => Effect.die("unused"),
				readForSession: () => Effect.die("unused"),
				readPath: () => Effect.die("unused"),
			}),
		),
	);
	await Effect.runPromise(
		Effect.gen(function* () {
			const client = yield* RpcTest.makeClient(
				RpcGroup.make(AttachmentUploadChunkRpc),
			);
			let chunks = 0;
			const result = yield* Effect.promise(() =>
				uploadAttachmentInChunks(
					{
						sessionId,
						bytes,
						mimeType: "application/zip",
						originalName: "archive.zip",
					},
					{
						upload: async () => {
							throw new Error("Must not send a single oversized request");
						},
						uploadChunk: async (input) => {
							expect(upload).not.toHaveBeenCalled();
							const json = JSON.stringify({
								_tag: "Request",
								id: "1",
								tag: "attachments.uploadChunk",
								payload: Schema.encodeSync(AttachmentUploadChunk)(input),
							});
							const frame = encodeWorkspaceGatewayFrame({
								direction: "client",
								connectionId: "mac-cloud",
								payload: json,
							});
							const decoded = decodeWorkspaceGatewayFrame(frame);
							const payload = Schema.decodeUnknownSync(AttachmentUploadChunk)(
								JSON.parse(decoded?.payload as string).payload,
							);
							chunks++;
							return Effect.runPromise(
								client["attachments.uploadChunk"](payload),
							);
						},
					},
				),
			);
			expect(chunks).toBe(4);
			expect(result.id).toBe("stored-zip");
			expect(upload).toHaveBeenCalledTimes(1);
		}).pipe(Effect.provide(services), Effect.scoped),
	);
});
