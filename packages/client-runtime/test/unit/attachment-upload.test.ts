import {
	ATTACHMENT_CHUNK_BYTES,
	MAX_ATTACHMENT_BYTES,
	SessionId,
} from "@zuse/contracts";
import { describe, expect, it, vi } from "vitest";
import { uploadAttachmentInChunks } from "../../src/attachment-upload.ts";

const input = (length: number) => ({
	sessionId: SessionId.make("upload"),
	bytes: new Uint8Array(length),
	mimeType: "application/zip",
	originalName: "file.zip",
});
const result = {
	id: "zip",
	mimeType: "application/zip",
	ext: "zip",
	sizeBytes: 0,
};

describe("bounded attachment uploads", () => {
	it("keeps empty and small files on the existing upload RPC", async () => {
		const transport = {
			upload: vi.fn().mockResolvedValue(result),
			uploadChunk: vi.fn(),
		};
		for (const size of [0, ATTACHMENT_CHUNK_BYTES]) {
			await expect(
				uploadAttachmentInChunks(input(size), transport),
			).resolves.toEqual(result);
		}
		expect(transport.uploadChunk).not.toHaveBeenCalled();
	});
	it("checks the total cap before sending bytes", async () => {
		const transport = { upload: vi.fn(), uploadChunk: vi.fn() };
		await expect(
			uploadAttachmentInChunks(input(MAX_ATTACHMENT_BYTES + 1), transport),
		).rejects.toThrow("File too large");
		expect(transport.upload).not.toHaveBeenCalled();
		expect(transport.uploadChunk).not.toHaveBeenCalled();
	});
	it("stops on a failed chunk and starts a fresh transfer on a user retry", async () => {
		const transport = {
			upload: vi.fn(),
			uploadChunk: vi
				.fn()
				.mockResolvedValueOnce(null)
				.mockRejectedValueOnce(new Error("disconnected")),
		};
		const file = input(7 * 1024 * 1024);
		await expect(uploadAttachmentInChunks(file, transport)).rejects.toThrow(
			"disconnected",
		);
		expect(transport.uploadChunk).toHaveBeenCalledTimes(2);
		const oldId = transport.uploadChunk.mock.calls[0]?.[0].uploadId;
		transport.uploadChunk
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(result);
		await expect(uploadAttachmentInChunks(file, transport)).resolves.toEqual(
			result,
		);
		expect(transport.uploadChunk.mock.calls[2]?.[0].uploadId).not.toBe(oldId);
		expect(transport.uploadChunk.mock.calls[2]?.[0].offset).toBe(0);
	});
	it("rejects premature or missing completion receipts", async () => {
		for (const response of [null, result]) {
			const transport = {
				upload: vi.fn(),
				uploadChunk: vi.fn().mockResolvedValue(response),
			};
			await expect(
				uploadAttachmentInChunks(input(ATTACHMENT_CHUNK_BYTES + 1), transport),
			).rejects.toThrow("did not complete");
		}
	});
});
