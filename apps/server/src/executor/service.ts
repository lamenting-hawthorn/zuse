import { ExecutorError, type ExecutorState } from "@zuse/contracts";
import { Effect, Schema } from "effect";
import { CredentialsService } from "../provider/services/credentials-service.ts";
import { ExecutorProfile, executorOrigin } from "./client.ts";

export const EXECUTOR_INTEGRATION = "executor";
export const EXECUTOR_ACCOUNT = "gateway";
export const readExecutorProfile = Effect.fn("Executor.readProfile")(
	function* () {
		const credentials = yield* CredentialsService;
		const saved = yield* credentials.getIntegration(
			EXECUTOR_INTEGRATION,
			EXECUTOR_ACCOUNT,
		);
		if (saved === null) return null;
		return yield* Effect.try({
			try: () => {
				const profile = Schema.decodeUnknownSync(ExecutorProfile)(
					JSON.parse(saved),
				);
				const url = executorOrigin(profile.url);
				if (
					!profile.token.trim() ||
					/[\r\n\0]/.test(profile.token) ||
					profile.token.length > 16384 ||
					(profile.toolkit !== null &&
						!/^[a-z0-9][a-z0-9-]{0,62}$/.test(profile.toolkit))
				)
					throw new Error("Invalid Executor profile");
				return { ...profile, url };
			},
			catch: () =>
				new ExecutorError({
					reason: "Executor settings could not be read. Reconnect in Plugins.",
				}),
		});
	},
);
export const executorUnavailableState = (
	profile: ExecutorProfile,
	error: string,
): ExecutorState => ({
	configured: true,
	url: profile.url,
	enabled: profile.enabled,
	toolkit: profile.toolkit,
	integrations: [],
	connections: [],
	toolkits: [],
	error,
});
