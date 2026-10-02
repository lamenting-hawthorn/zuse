import type { HarnessState, HarnessToolOutput } from "./state.ts";

export type { HarnessAgent, HarnessState, HarnessToolOutput } from "./state.ts";

import type { PermissionMode } from "@zuse/contracts";
import type { ModelMessage, ToolSet } from "ai";
import type { PromptCache } from "./prompt.ts";

export interface HarnessTool {
	readonly description: string;
	readonly parameters: Record<string, unknown>;
	readonly category:
		| "read"
		| "edit"
		| "execute"
		| "network"
		| "delegate"
		| "other"
		| "exit-plan";
}
export interface HarnessToolContext {
	readonly agentId: string;
	readonly callId: string;
	readonly signal: AbortSignal;
	readonly permissionMode: PermissionMode;
	readonly readOnly: boolean;
}
export interface HarnessModelInput {
	readonly rootId: string;
	readonly agentId: string;
	readonly model: string;
	readonly reasoning?: string;
	readonly messages: ModelMessage[];
	readonly tools: ToolSet;
	readonly signal: AbortSignal;
	readonly onText: (text: string) => void;
	/** Charge additional physical requests before a retry or account switch. */
	readonly beforeRetry?: () => Promise<void>;
}
export interface HarnessModelOutput {
	readonly messages: ModelMessage[];
	readonly calls: ReadonlyArray<{ id: string; name: string; input: unknown }>;
	readonly text: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cachedTokens?: number;
	readonly cacheWriteTokens?: number;
	readonly connectionId: string;
	readonly firstTokenMs?: number;
}
export interface HarnessHost {
	readonly tools: Readonly<Record<string, HarnessTool>>;
	readonly load: () => Promise<HarnessState | null>;
	readonly save: (state: HarnessState) => Promise<void>;
	readonly model: (input: HarnessModelInput) => Promise<HarnessModelOutput>;
	readonly execute: (
		name: string,
		input: unknown,
		context: HarnessToolContext,
	) => Promise<HarnessToolOutput>;
	readonly instructions: () => Promise<string>;
	readonly close: () => Promise<void>;
	readonly interruptAgents?: (ids: ReadonlyArray<string>) => Promise<void>;
	readonly notify: (event: HarnessEvent) => void;
	readonly windowTokens?: number;
	readonly autoCompactTokenLimit?: number;
	readonly effectiveContextWindowPercent?: number;
	readonly reasoning?: string;
	readonly maxRequests?: number;
	readonly enableSubagents?: boolean;
	/** Provider adapters without an autonomous turn dispatcher queue notices until the next send. */
	readonly automaticNotifications?: boolean;
	readonly promptCache?: PromptCache;
}

export type HarnessEvent =
	| {
			type: "context";
			agentId: string;
			usedTokens: number;
			windowTokens: number;
	  }
	| { type: "account"; agentId: string; name: string; switched: boolean }
	| {
			type: "compaction";
			itemId: string;
			startedAt: number;
			status: "in_progress" | "completed" | "failed";
			agentId: string;
			covered: number;
			before: number;
			after: number | null;
	  }
	| { type: "text"; agentId: string; itemId: string; text: string }
	| {
			type: "tool-start";
			agentId: string;
			call: { id: string; name: string; input: unknown };
	  }
	| {
			type: "tool-result";
			agentId: string;
			callId: string;
			output: HarnessToolOutput;
	  }
	| {
			type: "usage";
			agentId: string;
			usage: Pick<
				HarnessModelOutput,
				| "inputTokens"
				| "outputTokens"
				| "cachedTokens"
				| "cacheWriteTokens"
				| "connectionId"
				| "firstTokenMs"
			>;
	  }
	| { type: "paused"; agentId: string; reason: string }
	| { type: "completed"; agentId: string; summary: string };
