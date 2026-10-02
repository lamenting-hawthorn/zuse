import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
	AccountBroker,
	AccountsUnavailable,
} from "../../src/harness/account-broker.ts";
import {
	HarnessCache,
	promptCacheKey,
	stableJson,
} from "../../src/harness/cache.ts";
import { HarnessEngine } from "../../src/harness/engine.ts";
import { HarnessModelError } from "../../src/harness/model.ts";
import { contextLimits, PromptCache } from "../../src/harness/prompt.ts";
import type {
	HarnessHost,
	HarnessModelInput,
	HarnessModelOutput,
	HarnessState,
} from "../../src/harness/types.ts";

const response = (text = "done"): HarnessModelOutput => ({
	messages: [{ role: "assistant", content: text }],
	calls: [],
	text,
	inputTokens: 10,
	outputTokens: 2,
	connectionId: "one",
});
function fixture() {
	let state: HarnessState | null = null;
	let executions = 0;
	const host: { -readonly [K in keyof HarnessHost]: HarnessHost[K] } = {
		tools: {
			edit: {
				category: "edit",
				description: "edit",
				parameters: { type: "object", properties: {} },
			},
		},
		load: async () => state,
		save: async (value) => {
			state = structuredClone(value);
		},
		instructions: async () => "workspace",
		close: async () => {},
		notify: () => {},
		execute: async () => {
			executions++;
			return "edited";
		},
		model: async () => response(),
	};
	return { host, state: () => state, executions: () => executions };
}
const callResponse = (): HarnessModelOutput => ({
	...response(),
	messages: [
		{
			role: "assistant",
			content: [
				{
					type: "tool-call",
					toolCallId: "call-1",
					toolName: "edit",
					input: {},
				},
			],
		},
	],
	calls: [{ id: "call-1", name: "edit", input: {} }],
});
describe("durable harness", () => {
	it("persists completed response and intent before executing, then persists result before requesting again", async () => {
		const f = fixture();
		let requests = 0;
		f.host.model = async () => {
			requests++;
			if (requests === 1) return callResponse();
			expect(f.state()?.tools["root:call-1"]?.status).toBe("completed");
			return response();
		};
		f.host.execute = async () => {
			expect(f.state()?.agents[0]?.pendingCalls[0]?.id).toBe("call-1");
			expect(f.state()?.tools["root:call-1"]?.status).toBe("started");
			return "edited";
		};
		const engine = new HarnessEngine(f.host, "root", "model");
		await engine.initialize();
		await engine.send("edit");
		expect(engine.snapshot.agents[0]?.status).toBe("completed");
		expect(requests).toBe(2);
	});
	it("never executes tools from a failed model step", async () => {
		const f = fixture();
		f.host.model = async () => {
			throw new HarnessModelError("stream_incomplete");
		};
		const engine = new HarnessEngine(f.host, "root", "model");
		await engine.initialize();
		await engine.send("edit");
		expect(f.executions()).toBe(0);
		expect(engine.snapshot.agents[0]?.history).toHaveLength(3);
	});
	it("pauses on uncertain side effects after a crash instead of replaying", async () => {
		const f = fixture();
		f.host.model = async () => callResponse();
		f.host.execute = async () => {
			throw new Error("crash");
		};
		const initial = new HarnessEngine(f.host, "root", "model");
		await initial.initialize();
		const snapshot = initial.snapshot;
		const root = snapshot.agents.find((agent) => agent.id === "root");
		if (!root) throw new Error("Missing root");
		root.pendingCalls = callResponse().calls.map((call) => ({
			...call,
		}));
		snapshot.tools["root:call-1"] = { status: "started" };
		await f.host.save(snapshot);
		const recovered = new HarnessEngine(f.host, "root", "model");
		await recovered.initialize();
		await recovered.send("");
		expect(recovered.snapshot.agents[0]?.status).toBe("interrupted");
		expect(f.executions()).toBe(0);
	});
	it("resumes a known tool result without executing again", async () => {
		const f = fixture();
		const initial = new HarnessEngine(f.host, "root", "model");
		await initial.initialize();
		const snapshot = initial.snapshot;
		const root = snapshot.agents.find((agent) => agent.id === "root");
		if (!root) throw new Error("Missing root");
		root.pendingCalls = callResponse().calls.map((call) => ({
			...call,
		}));
		snapshot.tools["root:call-1"] = { status: "completed", output: "edited" };
		await f.host.save(snapshot);
		const recovered = new HarnessEngine(f.host, "root", "model");
		await recovered.initialize();
		await recovered.send("");
		expect(f.executions()).toBe(0);
		expect(
			recovered.snapshot.agents[0]?.history.some(
				(message) => message.role === "tool",
			),
		).toBe(true);
	});
	it("enforces one request budget across repeated tool steps", async () => {
		const f = fixture();
		const host = {
			...f.host,
			maxRequests: 2,
			model: async () => callResponse(),
		};
		const engine = new HarnessEngine(host, "root", "model");
		await engine.initialize();
		await engine.send("work");
		expect(engine.snapshot.requests).toBe(2);
		expect(engine.snapshot.agents[0]?.status).toBe("interrupted");
	});
});
describe("prompt cache", () => {
	it("canonicalizes schemas but preserves array order and scopes routing keys", () => {
		expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
			stableJson({ a: { c: 3, d: 2 }, b: 1 }),
		);
		expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
		expect(promptCacheKey("one", "model", "root")).toBe(
			promptCacheKey("one", "model", "root"),
		);
		expect(promptCacheKey("two", "model", "root")).not.toBe(
			promptCacheKey("one", "model", "root"),
		);
	});
	it("bounds retained memory, evicts least recent, bypasses oversized values", () => {
		const cache = new HarnessCache(20, 2);
		cache.set("a", "one");
		cache.set("b", "two");
		cache.get("a");
		cache.set("c", "three");
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("a")).toBe("one");
		cache.set("d", "x".repeat(21));
		expect(cache.size).toBe(2);
		expect(cache.retainedBytes).toBeLessThanOrEqual(20);
		cache.clear();
		expect(cache.retainedBytes).toBe(0);
	});
});
describe("account broker", () => {
	const input: HarnessModelInput = {
		rootId: "root",
		agentId: "root",
		model: "chosen",
		messages: [{ role: "user", content: "task" }],
		tools: {},
		signal: new AbortController().signal,
		onText: () => {},
	};
	it("switches only on confirmed usage exhaustion and shares health with children", async () => {
		const calls: string[] = [];
		const broker = new AccountBroker({
			connections: async () => [
				{ id: "one", preferred: true, authorized: true },
				{ id: "two", preferred: false, authorized: true },
			],
			switched: () => {},
			request: async (id, request) => {
				calls.push(id);
				expect(request.model).toBe("chosen");
				if (id === "one")
					throw new HarnessModelError(
						"subscription_sharing_usage_limit_exceeded",
						429,
					);
				return response();
			},
		});
		await broker.request(input);
		await broker.request({ ...input, agentId: "child" });
		expect(calls).toEqual(["one", "two", "two"]);
	});
	it("never cycles on policy errors and does not infer exhaustion resets", async () => {
		let requests = 0;
		const broker = new AccountBroker({
			connections: async () => [
				{ id: "one", preferred: true, authorized: true },
			],
			switched: () => {},
			request: async () => {
				requests++;
				throw new HarnessModelError("policy", 403);
			},
		});
		await expect(broker.request(input)).rejects.toThrow("policy");
		expect(requests).toBe(1);
		broker.invalidate("one", { reason: "exhausted" });
		await expect(broker.request(input)).rejects.toBeInstanceOf(
			AccountsUnavailable,
		);
		expect(requests).toBe(1);
	});
});

describe("native child contexts", () => {
	it("shares inherited prefix without allowing child messages to leak into the parent, then synthesizes results once", async () => {
		const f = fixture();
		let rootRequests = 0;
		let childRequests = 0;
		f.host.model = async (request) => {
			if (request.agentId !== "root") {
				childRequests++;
				expect(
					request.messages.some(
						(message) =>
							message.role === "user" && message.content === "original task",
					),
				).toBe(true);
				return response("child-result");
			}
			rootRequests++;
			if (rootRequests === 1)
				return {
					...response(),
					messages: [
						{
							role: "assistant",
							content: [
								{
									type: "tool-call",
									toolCallId: "spawn",
									toolName: "spawn_agent",
									input: { message: "child task" },
								},
							],
						},
					],
					calls: [
						{
							id: "spawn",
							name: "spawn_agent",
							input: { message: "child task" },
						},
					],
				};
			expect(
				request.messages.some((message) => message.content === "child task"),
			).toBe(false);
			return response("synthesis");
		};
		const engine = new HarnessEngine(f.host, "root", "model");
		await engine.initialize();
		await engine.send("original task");
		expect(childRequests).toBe(1);
		expect(rootRequests).toBe(3);
		expect(engine.snapshot.agents).toHaveLength(2);
		expect(
			engine.snapshot.agents.filter((agent) => agent.parentId)[0]
				?.completedDelivery,
		).toBe(true);
		const history =
			engine.snapshot.agents.find((agent) => agent.id === "root")?.history ??
			[];
		expect(
			history.filter(
				(message) =>
					typeof message.content === "string" &&
					message.content.includes("child-result"),
			),
		).toHaveLength(1);
	});
	it("root Stop aborts an active child and prevents final synthesis", async () => {
		const f = fixture();
		let rootRequests = 0;
		let childStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			childStarted = resolve;
		});
		f.host.model = async (request) => {
			if (request.agentId !== "root") {
				childStarted();
				return new Promise((_resolve, reject) =>
					request.signal.addEventListener(
						"abort",
						() => reject(new DOMException("Stopped", "AbortError")),
						{ once: true },
					),
				);
			}
			rootRequests++;
			if (rootRequests === 1)
				return {
					...response(),
					messages: [
						{
							role: "assistant",
							content: [
								{
									type: "tool-call",
									toolCallId: "spawn",
									toolName: "spawn_agent",
									input: { message: "work" },
								},
							],
						},
					],
					calls: [
						{ id: "spawn", name: "spawn_agent", input: { message: "work" } },
					],
				};
			return response();
		};
		const engine = new HarnessEngine(f.host, "root", "model");
		await engine.initialize();
		const turn = engine.send("task");
		await started;
		await engine.interrupt();
		await turn;
		expect(
			engine.snapshot.agents.every((agent) => agent.status === "interrupted"),
		).toBe(true);
	});
});

it("fails over only the model step after a completed edit and charges retries to the shared budget", async () => {
	const f = fixture();
	let calls = 0;
	const broker = new AccountBroker({
		connections: async () => [
			{ id: "one", preferred: true, authorized: true },
			{ id: "two", preferred: false, authorized: true },
		],
		switched: () => {},
		request: async (id, input) => {
			calls++;
			if (calls === 1) return callResponse();
			expect(input.messages.some((message) => message.role === "tool")).toBe(
				true,
			);
			if (id === "one")
				throw new HarnessModelError(
					"subscription_sharing_usage_limit_exceeded",
					429,
				);
			return { ...response(), connectionId: id };
		},
	});
	const engine = new HarnessEngine(
		{ ...f.host, model: (input) => broker.request(input) },
		"root",
		"model",
	);
	await engine.initialize();
	await engine.send("edit");
	expect(f.executions()).toBe(1);
	expect(engine.snapshot.requests).toBe(3);
	expect(engine.snapshot.agents[0]?.status).toBe("completed");
});

it("persists a compaction checkpoint and reuses it on cold resume", async () => {
	const f = fixture();
	const initial = new HarnessEngine(f.host, "root", "model");
	await initial.initialize();
	const state = initial.snapshot;
	const root = state.agents[0];
	if (!root) throw new Error("Missing root");
	root.history = [
		{ role: "system", content: "instructions" },
		{ role: "user", content: "original task" },
		{ role: "assistant", content: "a".repeat(4000) },
		{ role: "user", content: "current requirements" },
		{ role: "assistant", content: "recent result" },
		{ role: "user", content: "recent question" },
	];
	await f.host.save(state);
	let summaries = 0;
	f.host.model = async (request) => {
		if (Object.keys(request.tools).length === 0) {
			summaries++;
			return response(
				"Original task and current requirements; unresolved recent question.",
			);
		}
		expect(
			request.messages.some((message) => message.content === "original task"),
		).toBe(true);
		expect(
			request.messages.some(
				(message) =>
					typeof message.content === "string" &&
					message.content.startsWith("Durable context summary:"),
			),
		).toBe(true);
		return response("done");
	};
	const host = { ...f.host, windowTokens: 1000 };
	const engine = new HarnessEngine(host, "root", "model");
	await engine.initialize();
	await engine.send("");
	expect(summaries).toBe(1);
	expect(engine.snapshot.agents[0]?.checkpoint?.covered).toBeGreaterThan(0);
	const resumed = new HarnessEngine(host, "root", "model");
	await resumed.initialize();
	await resumed.send("continue");
	expect(summaries).toBe(1);
});

it("durably deduplicates process notifications and wakes completed roots without resetting budget", async () => {
	const f = fixture();
	const engine = new HarnessEngine(f.host, "root", "model");
	await engine.initialize();
	await engine.send("task");
	const before = engine.snapshot.requests;
	await engine.enqueueNotification(
		"process:completed",
		"root",
		"command finished",
	);
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(engine.snapshot.requests).toBe(before + 1);
	const messages = engine.snapshot.agents[0]?.history.filter(
		(message) =>
			message.role === "user" &&
			typeof message.content === "string" &&
			message.content.includes("command finished"),
	);
	expect(messages).toHaveLength(1);
	await engine.enqueueNotification(
		"process:completed",
		"root",
		"command finished",
	);
	expect(engine.snapshot.requests).toBe(before + 1);
	await engine.close();
});
it("Stop cancels process owners even after the model finished and prevents notification wakeup", async () => {
	const f = fixture();
	const interrupted: string[][] = [];
	f.host.interruptAgents = async (ids) => {
		interrupted.push([...ids]);
	};
	const engine = new HarnessEngine(f.host, "root", "model");
	await engine.initialize();
	await engine.send("task");
	await engine.interrupt();
	const before = engine.snapshot.requests;
	await engine.enqueueNotification("process:completed", "root", "stopped");
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(engine.snapshot.requests).toBe(before);
	expect(interrupted).toEqual([["root"]]);
	expect(engine.snapshot.agents[0]?.mailbox).toHaveLength(1);
	await engine.close();
});
it("recovered process notifications wait for explicit Continue", async () => {
	const f = fixture();
	const first = new HarnessEngine(f.host, "root", "model");
	await first.initialize();
	await first.send("task");
	await first.close();
	const resumed = new HarnessEngine(f.host, "root", "model");
	await resumed.initialize();
	const before = resumed.snapshot.requests;
	await resumed.enqueueNotification(
		"recovered:completed",
		"root",
		"interrupted on restart",
	);
	expect(resumed.snapshot.requests).toBe(before);
	await resumed.send("");
	expect(resumed.snapshot.agents[0]?.mailbox).toHaveLength(0);
	await resumed.close();
});

it("estimates image input without treating base64 bytes as text tokens", () => {
	const cache = new PromptCache();
	const estimate = cache.estimate(
		[
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "image",
						toolName: "read_image",
						output: {
							type: "content",
							value: [
								{
									type: "file",
									mediaType: "image/png",
									data: { type: "data", data: "a".repeat(200_000) },
								},
							],
						},
					},
				],
			},
		],
		"model",
	);
	expect(estimate).toBeGreaterThanOrEqual(8192);
	expect(estimate).toBeLessThan(9000);
});

it.each([
	"retry",
	"safe-reduction",
	"large-tail",
	"pinned-task",
	"failure",
	"cancel",
] as const)("compaction handles %s with bounded requests and lifecycle events", async (scenario) => {
	const f = fixture();
	const events: import("../../src/harness/types.ts").HarnessEvent[] = [];
	f.host.notify = (event) => events.push(event);
	const initial = new HarnessEngine(f.host, "root", "model");
	await initial.initialize();
	const state = initial.snapshot;
	const root = state.agents[0];
	if (!root) throw new Error("Missing root");
	root.history = [
		{ role: "system", content: "instructions" },
		{
			role: "user",
			content:
				scenario === "pinned-task" ? "task".repeat(340) : "original task",
		},
		{ role: "assistant", content: "old ".repeat(1200) },
		{ role: "user", content: "current requirement" },
		{
			role: "assistant",
			content:
				scenario === "large-tail" ? "recent ".repeat(600) : "recent result",
		},
		{ role: "user", content: "continue" },
	];
	await f.host.save(state);
	let summaries = 0;
	f.host.model = async (request) => {
		if (Object.keys(request.tools).length) return response("done");
		summaries++;
		expect(
			events.some((e) => e.type === "compaction" && e.status === "in_progress"),
		).toBe(true);
		if (scenario === "cancel") throw new DOMException("Aborted", "AbortError");
		if (scenario === "failure" || (scenario === "retry" && summaries === 1))
			return response("large ".repeat(1000));
		return response(
			scenario === "safe-reduction"
				? "s".repeat(1600)
				: "Original task, current requirement, pending continuation. Tools already completed.",
		);
	};
	const engine = new HarnessEngine(
		{ ...f.host, windowTokens: 1000 },
		"root",
		"model",
	);
	await engine.initialize();
	await engine.send("");
	const compactions = events.filter((e) => e.type === "compaction");
	expect(compactions.map((e) => e.status)).toEqual([
		"in_progress",
		scenario === "failure" || scenario === "cancel" ? "failed" : "completed",
	]);
	expect(compactions[0]?.itemId).toBe(compactions[1]?.itemId);
	expect(summaries).toBe(
		scenario === "retry" ||
			scenario === "failure" ||
			scenario === "safe-reduction" ||
			scenario === "pinned-task"
			? 2
			: 1,
	);
	expect(
		engine.snapshot.agents[0]?.history.slice(0, root.history.length),
	).toEqual(root.history);
	if (scenario === "failure" || scenario === "cancel")
		expect(engine.snapshot.agents[0]?.checkpoint).toBeUndefined();
	else expect(engine.snapshot.agents[0]?.checkpoint).toBeDefined();
});

it("estimates image input without counting base64 bytes as text tokens", () => {
	const prompts = new PromptCache();
	const estimate = (size: number) =>
		prompts.estimate(
			[
				{
					role: "user",
					content: [
						{ type: "image", image: "a".repeat(size), mediaType: "image/png" },
					],
				},
			],
			"model",
		);
	expect(estimate(100)).toBe(estimate(100000));
	expect(estimate(100)).toBeGreaterThan(8192);
});

it("matches Codex model context and auto-compaction limits", () => {
	expect(contextLimits(1_000_000)).toEqual({
		windowTokens: 1_000_000,
		usableTokens: 950_000,
		compactAt: 900_000,
	});
	expect(contextLimits(250_000, 180_000).compactAt).toBe(180_000);
	expect(contextLimits(250_000, 240_000).compactAt).toBe(225_000);
	expect(contextLimits(250_000, 0).compactAt).toBe(225_000);
	expect(contextLimits(250_000, undefined, 92).usableTokens).toBe(230_000);
	expect(contextLimits().compactAt).toBe(28_800);
});

it.each([
	undefined,
	2400,
])("compacts at the model limit %s or 90%, not the old 80% threshold", async (autoCompactTokenLimit) => {
	const f = fixture();
	const initial = new HarnessEngine(f.host, "root", "model");
	await initial.initialize();
	const state = initial.snapshot;
	const root = state.agents[0];
	if (!root) throw new Error("Missing root");
	root.history = [
		{ role: "system", content: "instructions" },
		{ role: "user", content: "task" },
		{ role: "assistant", content: "a".repeat(7500) },
		{ role: "user", content: "continue" },
	];
	const estimated = new PromptCache().estimate(root.history, "model");
	expect(estimated).toBeGreaterThan(2400);
	expect(estimated).toBeLessThan(2700);
	await f.host.save(state);
	let summaries = 0;
	f.host.model = async (request) => {
		if (!Object.keys(request.tools).length) summaries++;
		return response("done");
	};
	const engine = new HarnessEngine(
		{ ...f.host, windowTokens: 3000, autoCompactTokenLimit },
		"root",
		"model",
	);
	await engine.initialize();
	await engine.send("");
	expect(summaries).toBe(autoCompactTokenLimit === undefined ? 0 : 1);
});

it("reuses immutable-message estimates before serialization across forks and invalidates on clear", () => {
	let reads = 0;
	const message: ModelMessage = {
		role: "user",
		get content() {
			reads++;
			return "shared prefix";
		},
	};
	const prompts = new PromptCache();
	const first = prompts.estimate([message], "model");
	const before = reads;
	expect(prompts.estimate([message], "model")).toBe(first);
	expect(reads).toBe(before);
	expect(
		prompts.estimate([message, { role: "user", content: "child" }], "model"),
	).toBeGreaterThan(first);
	expect(reads).toBe(before);
	prompts.estimate([message], "other-model");
	expect(reads).toBeGreaterThan(before);
	const beforeClear = reads;
	prompts.cache.clear();
	prompts.estimate([message], "model");
	expect(reads).toBeGreaterThan(beforeClear);
});
