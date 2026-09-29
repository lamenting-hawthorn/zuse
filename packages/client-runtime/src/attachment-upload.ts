import {
	ATTACHMENT_CHUNK_BYTES,
	type AttachmentUploadChunk,
	type AttachmentUploadResult,
	MAX_ATTACHMENT_BYTES,
} from "@zuse/contracts";

type UploadInput = Omit<
	AttachmentUploadChunk,
	"uploadId" | "offset" | "totalBytes"
>;

/** Keep binary uploads below the gateway frame limit on every client. */
export const uploadAttachmentInChunks = async (
	input: UploadInput,
	transport: {
		upload: (input: UploadInput) => Promise<AttachmentUploadResult>;
		uploadChunk: (
			input: AttachmentUploadChunk,
		) => Promise<AttachmentUploadResult | null>;
	},
): Promise<AttachmentUploadResult> => {
	if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
		throw new Error("File too large (max 100 MB)");
	}
	if (input.bytes.byteLength <= ATTACHMENT_CHUNK_BYTES) {
		return transport.upload(input);
	}
	const uploadId = crypto.randomUUID();
	for (
		let offset = 0;
		offset < input.bytes.byteLength;
		offset += ATTACHMENT_CHUNK_BYTES
	) {
		const bytes = input.bytes.subarray(offset, offset + ATTACHMENT_CHUNK_BYTES);
		const result = await transport.uploadChunk({
			...input,
			bytes,
			uploadId,
			offset,
			totalBytes: input.bytes.byteLength,
		});
		const final = offset + bytes.byteLength === input.bytes.byteLength;
		if (final && result !== null) return result;
		if (final || result !== null) {
			throw new Error("File upload did not complete. Please attach it again.");
		}
	}
	throw new Error("File upload did not complete. Please attach it again.");
};
