import { Effect, Schema } from "effect";

import { type ApiError, badRequest } from "./errors.ts";

export const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

export const decodeBody = <A, I>(
	schema: Schema.Codec<A, I>,
	request: Request,
	maxBytes?: number,
): Effect.Effect<A, ApiError> =>
	Effect.tryPromise({
		try: async (): Promise<unknown> => {
			if (maxBytes === undefined) return request.json();
			const reader = request.body?.getReader();
			if (!reader) throw new Error("missing_body");
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					size += value.byteLength;
					if (size > maxBytes) {
						await reader.cancel();
						throw new Error("body_too_large");
					}
					chunks.push(value);
				}
			} finally {
				reader.releaseLock();
			}
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return JSON.parse(new TextDecoder().decode(bytes));
		},
		catch: () => badRequest("invalid_json"),
	}).pipe(
		Effect.flatMap(Schema.decodeUnknownEffect(schema)),
		Effect.mapError(() => badRequest("invalid_request")),
	);

export const decodePathSegment = (
	segment: string,
): Effect.Effect<string, ApiError> =>
	Effect.try({
		try: () => decodeURIComponent(segment),
		catch: () => badRequest("invalid_path_encoding"),
	});

/** Bound memory before parsing untrusted JSON, including chunked requests. */
export const readLimitedJsonBody = async (
	request: Request,
	maxBytes: number,
): Promise<unknown> => {
	if (Number(request.headers.get("content-length")) > maxBytes)
		throw badRequest("request_too_large");
	const reader = request.body?.getReader();
	if (!reader) throw badRequest("invalid_json");
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = "";
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			bytes += next.value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel();
				throw badRequest("request_too_large");
			}
			text += decoder.decode(next.value, { stream: true });
		}
		return JSON.parse(text + decoder.decode());
	} finally {
		reader.releaseLock();
	}
};
