import { Effect, Layer } from "effect";
import { AppPaths } from "../app-paths.ts";
import { CredentialsService } from "../provider/services/credentials-service.ts";
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
import { chatGPTVault } from "./vault.ts";
export const modelConnectionsLayer = (available: boolean, cloud = false) =>
	Layer.effect(
		ModelConnections,
		Effect.gen(function* () {
			const legacy = yield* CredentialsService;
			const credentials = yield* modelConnectionDatabase(legacy);
			const paths = yield* AppPaths;
			const auth = new ChatGPTOAuth(chatGPTVault(credentials, paths.userData));
			const grok = new GrokOAuth(
				chatGPTVault(credentials, paths.userData, "supergrok"),
				process.env.ZUSE_XAI_OAUTH_CLIENT_ID ?? XAI_PUBLIC_CLIENT_ID,
			);
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					auth.close();
					grok.close();
				}),
			);
			const local = makeModelConnections(auth, available, grok);
			if (!available && !cloud) return local;
			const account = yield* accountModelConnections(
				credentials,
				paths.userData,
				cloud,
			);
			return combineModelConnections(local, account);
		}),
	);
