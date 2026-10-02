import { describe, expect, it } from "vitest";
import {
	modelTools,
	requestModel,
	subscriptionFetch,
} from "../../src/harness/model.ts";
import type { HarnessModelInput } from "../../src/harness/types.ts";

const input: HarnessModelInput = {
	rootId: "root",
	agentId: "root",
	model: "gpt-5",
	messages: [
		{ role: "system", content: "stable" },
		{ role: "user", content: "hello" },
	],
	tools: modelTools({
		read: {
			description: "Read",
			category: "read",
			parameters: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
			},
		},
	}),
	signal: new AbortController().signal,
	onText: () => {},
};
function stream(
	events: unknown[],
	capture?: (body: Record<string, unknown>) => void,
): typeof fetch {
	return async (_url, init) => {
		capture?.(JSON.parse(String(init?.body)));
		const encoded = new TextEncoder().encode(
			events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
		);
		return new Response(
			new ReadableStream({
				start(controller) {
					for (let start = 0; start < encoded.length; start += 7)
						controller.enqueue(encoded.slice(start, start + 7));
					controller.close();
				},
			}),
			{ headers: { "Content-Type": "text/event-stream" } },
		);
	};
}
const created = {
	type: "response.created",
	response: { id: "response-1", created_at: 1, model: "gpt-5" },
};
const completed = {
	type: "response.completed",
	response: {
		id: "response-1",
		status: "completed",
		usage: {
			input_tokens: 10,
			output_tokens: 2,
			input_tokens_details: { cached_tokens: 7 },
		},
	},
};
describe("AI SDK subscription transport", () => {
	it("uses explicit portable input and supported request fields with fragmented streams", async () => {
		let text = "";
		const output = await requestModel(
			{
				...input,
				onText: (delta) => {
					text += delta;
				},
			},
			{ connectionId: "account", accessToken: "private-token" },
			stream(
				[
					created,
					{
						type: "response.output_item.added",
						output_index: 0,
						item: {
							id: "msg-1",
							type: "message",
							role: "assistant",
							content: [],
						},
					},
					{
						type: "response.output_text.delta",
						item_id: "msg-1",
						output_index: 0,
						content_index: 0,
						delta: "hello",
					},
					{
						type: "response.output_item.done",
						output_index: 0,
						item: {
							id: "msg-1",
							type: "message",
							role: "assistant",
							content: [
								{ type: "output_text", text: "hello", annotations: [] },
							],
						},
					},
					completed,
				],
				(body) => {
					expect(body.store).toBe(false);
					expect(body.stream).toBe(true);
					expect(body.previous_response_id).toBeUndefined();
					expect(body.max_output_tokens).toBeUndefined();
					expect(body.prompt_cache_retention).toBeUndefined();
					expect(body.input).toEqual(
						expect.arrayContaining([
							expect.objectContaining({ role: "developer" }),
						]),
					);
					expect(body.tools).toEqual(
						expect.arrayContaining([
							expect.objectContaining({ type: "namespace", name: "zuse" }),
						]),
					);
				},
			),
		);
		expect(text).toBe("hello");
		expect(output.text).toBe("hello");
		expect(output.cachedTokens).toBe(7);
	});
	it("returns complete namespaced tool arguments only after successful completion", async () => {
		const output = await requestModel(
			input,
			{ connectionId: "account", accessToken: "secret" },
			stream([
				created,
				{
					type: "response.output_item.added",
					output_index: 0,
					item: {
						id: "fc-1",
						type: "function_call",
						call_id: "call-1",
						name: "read",
						namespace: "zuse",
						arguments: "",
					},
				},
				{
					type: "response.function_call_arguments.delta",
					item_id: "fc-1",
					output_index: 0,
					delta: '{"path":',
				},
				{
					type: "response.function_call_arguments.delta",
					item_id: "fc-1",
					output_index: 0,
					delta: '"file.ts"}',
				},
				{
					type: "response.output_item.done",
					output_index: 0,
					item: {
						id: "fc-1",
						type: "function_call",
						call_id: "call-1",
						name: "read",
						namespace: "zuse",
						arguments: '{"path":"file.ts"}',
						status: "completed",
					},
				},
				completed,
			]),
		);
		expect(output.calls).toEqual([
			{ id: "call-1", name: "read", input: { path: "file.ts" } },
		]);
	});

	it("reports cache usage as unknown when the provider omits it", async () => {
		const output = await requestModel(
			input,
			{ connectionId: "account", accessToken: "secret" },
			stream([
				created,
				{
					type: "response.completed",
					response: { usage: { input_tokens: 10, output_tokens: 0 } },
				},
			]),
		);
		expect(output.cachedTokens).toBeUndefined();
		expect(output.cacheWriteTokens).toBeUndefined();
	});

	it("rejects a stream that disconnects without completion", async () => {
		await expect(
			requestModel(
				input,
				{ connectionId: "account", accessToken: "secret" },
				stream([created]),
			),
		).rejects.toThrow();
	});
	it("rejects incomplete responses even after visible text", async () => {
		await expect(
			requestModel(
				input,
				{ connectionId: "account", accessToken: "secret" },
				stream([
					created,
					{
						type: "response.incomplete",
						response: {
							incomplete_details: { reason: "max_output_tokens" },
							usage: { input_tokens: 1, output_tokens: 1 },
						},
					},
				]),
			),
		).rejects.toThrow();
	});
	it("preserves confirmed usage-limit errors that arrive after output starts", async () => {
		await expect(
			requestModel(
				input,
				{ connectionId: "account", accessToken: "secret" },
				stream([
					created,
					{
						type: "response.output_item.added",
						output_index: 0,
						item: {
							id: "msg-1",
							type: "message",
							role: "assistant",
							content: [],
						},
					},
					{
						type: "response.output_text.delta",
						item_id: "msg-1",
						output_index: 0,
						delta: "partial",
					},
					{
						type: "response.failed",
						sequence_number: 3,
						response: {
							error: {
								code: "subscription_sharing_usage_limit_exceeded",
								message: "limit",
							},
						},
					},
				]),
			),
		).rejects.toThrow("subscription_sharing_usage_limit_exceeded");
	});
	it("blocks unsupported fields before network access", async () => {
		let requests = 0;
		const guarded = subscriptionFetch(async () => {
			requests++;
			return new Response();
		});
		await expect(
			guarded("https://api.openai.com/v1/responses", {
				body: JSON.stringify({
					model: "gpt-5",
					temperature: 0,
					store: false,
					stream: true,
					input: [],
				}),
			}),
		).rejects.toThrow("unsupported_request_field");
		expect(requests).toBe(0);
	});
});

it("transports locally read images as Responses tool-result content", async () => {
	let body: Record<string, unknown> | undefined;
	await requestModel(
		{
			...input,
			messages: [
				...input.messages,
				{
					role: "assistant",
					content: [
						{
							type: "tool-call",
							toolCallId: "image-call",
							toolName: "read_image",
							input: { path: "image.png" },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "image-call",
							toolName: "read_image",
							output: {
								type: "content",
								value: [
									{
										type: "file",
										mediaType: "image/png",
										data: { type: "data", data: "aGVsbG8=" },
									},
								],
							},
						},
					],
				},
			],
		},
		{ connectionId: "account", accessToken: "test" },
		stream([created, completed], (value) => {
			body = value;
		}),
	);
	expect(JSON.stringify(body?.input)).toContain(
		"data:image/png;base64,aGVsbG8=",
	);
});

it("routes SuperGrok credentials through the AI SDK xAI Responses transport without OpenAI subscription fields", async () => {
	let target = "";
	let body: Record<string, unknown> = {};
	const fetcher = stream(
		[
			{
				...created,
				response: { ...created.response, object: "response", output: [] },
			},
			{
				...completed,
				response: { ...completed.response, object: "response", output: [] },
			},
		],
		(value) => {
			body = value;
		},
	);
	const output = await requestModel(
		{ ...input, model: "grok-test", tools: {} },
		{
			connectionId: "grok-account",
			accessToken: "grok-secret",
			provider: "supergrok",
		},
		async (url, init) => {
			target = String(url);
			expect(new Headers(init?.headers).get("authorization")).toBe(
				"Bearer grok-secret",
			);
			return fetcher(url, init);
		},
	);
	expect(target).toBe("https://api.x.ai/v1/responses");
	expect(body.store).toBe(false);
	expect(body.stream).toBe(true);
	expect(body.model).toBe("grok-test");
	expect(body).not.toHaveProperty("prompt_cache_key");
	expect(output.connectionId).toBe("grok-account");
});
