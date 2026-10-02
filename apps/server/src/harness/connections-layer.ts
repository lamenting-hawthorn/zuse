import { canUseExperimentalHarness } from "@zuse/utils/feature-access";
import { Effect, Layer } from "effect";
import { AppPaths } from "../app-paths.ts";
import { AuthService } from "../auth/services/auth-service.ts";
import { CredentialsService } from "../provider/services/credentials-service.ts";
import { gateModelConnections } from "./access.ts";
import {
	accountModelConnections,
	combineModelConnections,
} from "./account-connections-service.ts";
import { ChatGPTOAuth } from "./chatgpt-oauth.ts";
import { modelConnectionDatabase } from "./connection-database.ts";
import {
	ModelConnections,
	makeModelConnections,
} from "./connections-service.ts";
import { GrokOAuth, XAI_PUBLIC_CLIENT_ID } from "./grok-oauth.ts";
import { modelConnectionVault } from "./vault.ts";
export const modelConnectionsLayer = (
	available: boolean,
	cloud = false,
	masterKey?: (create?: boolean) => Promise<Buffer>,
) =>
	Layer.effect(
		ModelConnections,
		Effect.gen(function* () {
			const identity = yield* AuthService;
			const allowed = Effect.suspend(() => identity.getSession()).pipe(
				Effect.map((state) =>
					canUseExperimentalHarness(
						state._tag === "SignedIn" ? state.session.user.email : null,
					),
				),
			);
			const legacy = yield* CredentialsService;
			const credentials = masterKey
				? yield* modelConnectionDatabase(legacy, masterKey)
				: legacy;
			const paths = yield* AppPaths;
			const auth = new ChatGPTOAuth(
				modelConnectionVault(credentials, paths.userData),
			);
			const grok = new GrokOAuth(
				modelConnectionVault(credentials, paths.userData, "supergrok"),
				process.env.ZUSE_XAI_OAUTH_CLIENT_ID ?? XAI_PUBLIC_CLIENT_ID,
			);
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					auth.close();
					grok.close();
				}),
			);
			const local = makeModelConnections(auth, available, grok);
			if (!available && !cloud) return gateModelConnections(local, allowed);
			const account = yield* accountModelConnections(
				credentials,
				paths.userData,
				cloud,
			);
			return gateModelConnections(
				combineModelConnections(local, account),
				allowed,
			);
		}),
	);
