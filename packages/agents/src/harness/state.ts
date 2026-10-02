import { modelMessageSchema } from "ai";
import { z } from "zod";

export const harnessToolOutputSchema = z.union([
	z.string(),
	z.object({
		type: z.literal("content"),
		value: z.array(
			z.object({
				type: z.literal("file"),
				mediaType: z.enum([
					"image/png",
					"image/jpeg",
					"image/gif",
					"image/webp",
				]),
				data: z.object({ type: z.literal("data"), data: z.string() }),
			}),
		),
	}),
]);
export type HarnessToolOutput = z.infer<typeof harnessToolOutputSchema>;
const agentSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	parentId: z.string().nullable(),
	parentItemId: z.string().nullable(),
	depth: z.number().int().min(0).max(2),
	readOnly: z.boolean(),
	history: z.array(modelMessageSchema),
	mailbox: z.array(
		z.object({
			id: z.string(),
			text: z.string(),
			images: z
				.array(z.object({ mediaType: z.string(), data: z.string() }))
				.optional(),
		}),
	),
	status: z.enum(["idle", "running", "completed", "interrupted", "error"]),
	turns: z.number().int().nonnegative(),
	summary: z.string(),
	pendingCalls: z.array(
		z.object({ id: z.string(), name: z.string(), input: z.unknown() }),
	),
	completedDelivery: z.boolean(),
	checkpoint: z
		.object({ covered: z.number().int().nonnegative(), summary: z.string() })
		.optional(),
});
const stateSchema = z.object({
	version: z.literal(1),
	rootId: z.string(),
	model: z.string(),
	reasoning: z.string().optional(),
	agents: z.array(agentSchema),
	requests: z.number().int().nonnegative(),
	notifications: z.array(z.string()).optional(),
	tools: z.record(
		z.string(),
		z.object({
			status: z.enum(["started", "completed"]),
			output: harnessToolOutputSchema.optional(),
			signature: z.string().optional(),
		}),
	),
});
export type HarnessAgent = z.infer<typeof agentSchema>;
export type HarnessState = z.infer<typeof stateSchema>;
export function decodeHarnessState(value: unknown): HarnessState {
	const parsed = stateSchema.safeParse(value);
	if (!parsed.success)
		throw new Error(
			"Invalid harness checkpoint. Preserve the journal for inspection.",
		);
	const state = parsed.data;
	const byId = new Map(state.agents.map((agent) => [agent.id, agent]));
	if (
		byId.size !== state.agents.length ||
		state.agents.filter((agent) => agent.parentId === null).length !== 1
	)
		throw new Error("Invalid harness graph");
	const root = byId.get(state.rootId);
	if (!root || root.parentId !== null || root.depth !== 0)
		throw new Error("Invalid harness root");
	for (const agent of state.agents) {
		if (agent.parentId) {
			const parent = byId.get(agent.parentId);
			if (!parent || parent.depth !== agent.depth - 1)
				throw new Error("Invalid harness parent");
		}
		if (agent.checkpoint && agent.checkpoint.covered > agent.history.length)
			throw new Error("Invalid compaction boundary");
	}
	return state;
}
