import {
	type SandboxProviderAdapter,
	SandboxProviderError,
} from "@zuse/sandbox-providers";
import { Clock, Effect, Schema } from "effect";
import {
	type CloudWorkspaceRecord,
	CloudWorkspaceStore,
} from "./cloud-workspace-store.ts";

export const MachineForkSource = Schema.Struct({
	workspaceId: Schema.String,
	providerSandboxId: Schema.String,
	chatId: Schema.String,
	sessionId: Schema.String,
	messageId: Schema.String,
});

export const machineForkSource = (workspace: CloudWorkspaceRecord) =>
	workspace.requestConfig.machineFork === undefined
		? undefined
		: Schema.decodeUnknownSync(MachineForkSource)(
				workspace.requestConfig.machineFork,
			);

/** The parent lease and durable recovery intent outlive any provider request. */
export const forkCloudWorkspaceMachine = Effect.fn("forkCloudWorkspaceMachine")(
	function* (
		workspace: CloudWorkspaceRecord,
		provider: SandboxProviderAdapter,
		providerLabel: string,
		timeoutSeconds: number,
	) {
		const fork = machineForkSource(workspace);
		const forkMachine = provider.forkMachine;
		if (
			fork === undefined ||
			workspace.provider !== "boxd" ||
			forkMachine === undefined
		)
			return yield* new SandboxProviderError({ code: "rejected" });
		const store = yield* CloudWorkspaceStore;
		const now = yield* Clock.currentTimeMillis;
		const owner = crypto.randomUUID();
		const source = yield* store.claimWorkspace(
			fork.workspaceId,
			owner,
			now,
			now + 10 * 60_000,
		);
		if (source === null)
			return yield* new SandboxProviderError({ code: "transient" });
		return yield* Effect.gen(function* () {
			if (
				source.accountId !== workspace.accountId ||
				source.provider !== "boxd" ||
				source.providerSandboxId !== fork.providerSandboxId ||
				source.state !== "ready" ||
				source.desiredState !== "ready"
			)
				return yield* new SandboxProviderError({ code: "rejected" });
			const fenced = {
				...source,
				requestConfig: {
					...source.requestConfig,
					forkNetworkRestorePending: true,
				},
				revision: source.revision + 1,
				updatedAtMs: now,
				nextActionAtMs: now,
			};
			const saved = yield* store.saveClaimedWorkspace({
				workspace: fenced,
				leaseOwner: owner,
				expectedRevision: source.revision,
				expectedUpdatedAtMs: source.updatedAtMs,
			});
			if (!saved) return yield* new SandboxProviderError({ code: "transient" });
			return yield* forkMachine({
				sourceSandboxId: fork.providerSandboxId,
				providerLabel,
				timeoutSeconds,
			}).pipe(
				Effect.ensuring(
					Effect.gen(function* () {
						yield* provider.setNetwork(fork.providerSandboxId, {
							kind: "open",
						});
						const current = yield* store.getWorkspace(source.workspaceId);
						if (current === null) return;
						yield* store.saveClaimedWorkspace({
							workspace: {
								...current,
								requestConfig: {
									...current.requestConfig,
									forkNetworkRestorePending: undefined,
								},
								revision: current.revision + 1,
								updatedAtMs: yield* Clock.currentTimeMillis,
							},
							leaseOwner: owner,
							expectedRevision: current.revision,
							expectedUpdatedAtMs: current.updatedAtMs,
						});
					}).pipe(Effect.ignore),
				),
			);
		}).pipe(
			Effect.ensuring(store.releaseWorkspaceLease(source.workspaceId, owner)),
		);
	},
);
