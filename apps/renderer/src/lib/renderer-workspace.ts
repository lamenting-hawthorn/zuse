import { workspaceScopeKey } from "@zuse/client-runtime/environment-scope";
import type { WorkspaceScope } from "@zuse/contracts";

export { workspaceScopeKey } from "@zuse/client-runtime/environment-scope";

import { WorkspaceScope as WorkspaceScopeSchema } from "@zuse/contracts";
import { Schema } from "effect";
import {
	rendererAccountSnapshot,
	subscribeRendererAccount,
} from "./renderer-account.ts";

export const createRendererWorkspaceState = () => {
	let current: Readonly<{ scope: WorkspaceScope; key: string; epoch: number }> =
		{
			scope: { kind: "personal" },
			key: "personal",
			epoch: 0,
		};
	const listeners = new Set<() => void>();
	const publish = (scope: WorkspaceScope) => {
		current = {
			scope,
			key: workspaceScopeKey(scope),
			epoch: current.epoch + 1,
		};
		for (const listener of listeners) listener();
	};
	return {
		snapshot: () => current,
		select: (scope: WorkspaceScope) => {
			const validated = Schema.decodeUnknownSync(WorkspaceScopeSchema)(scope);
			if (workspaceScopeKey(validated) !== current.key) publish(validated);
		},
		reset: () => publish({ kind: "personal" }),
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
};

const workspace = createRendererWorkspaceState();
export const rendererWorkspaceSnapshot = workspace.snapshot;
export const subscribeRendererWorkspace = workspace.subscribe;
export const selectRendererWorkspace = (scope: WorkspaceScope): void => {
	if (scope.kind === "organization" && !rendererAccountSnapshot().subject)
		throw new Error("Sign in before selecting an organization.");
	workspace.select(scope);
};
subscribeRendererAccount(workspace.reset);

export const assertRendererWorkspaceCurrent = (
	expected: ReturnType<typeof rendererWorkspaceSnapshot>,
): void => {
	if (expected !== rendererWorkspaceSnapshot())
		throw new Error("The workspace changed. Retry in the selected workspace.");
};
