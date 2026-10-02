import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, ManagedRuntime } from "effect";
import { expect, it, vi } from "vitest";
import { AppPaths } from "../../src/app-paths.ts";
import { ConfigStoreServiceLive } from "../../src/config-store/layers/config-store-service.ts";
import { HarnessProvider } from "../../src/harness/provider.ts";
import { ModelCatalogServiceLive } from "../../src/model-catalog/layers/model-catalog-service.ts";
import { ModelCatalogService } from "../../src/model-catalog/services/model-catalog-service.ts";
import { makeFileCredentialsService } from "../../src/provider/layers/file-credentials-service.ts";

it("publishes authorized Zuse models to the chat catalog and removes disconnected inventory", async () => {
	const dir = await mkdtemp(join(tmpdir(), "zuse-native-catalog-"));
	vi.stubEnv("ZUSE_CONFIG_DIR", join(dir, "config"));
	let connected = true;
	const inventory = vi.fn(() =>
		Effect.succeed(
			connected
				? [
						{ id: "chatgpt/gpt-6.1-sol", label: "GPT-6.1 Sol" },
						{ id: "supergrok/grok-code-fast-1", label: "Grok Code Fast" },
					]
				: [],
		),
	);
	const dependencies = Layer.mergeAll(
		ConfigStoreServiceLive.pipe(
			Layer.provide(Layer.succeed(AppPaths, { userData: dir })),
			Layer.provide(NodeServices.layer),
		),
		makeFileCredentialsService(dir),
		Layer.succeed(AppPaths, { userData: dir }),
		NodeServices.layer,
		Layer.succeed(HarnessProvider, {
			inventory,
			fingerprint: () => Effect.succeed(String(connected)),
			availability: () => Effect.die("not used by model catalog"),
			start: () => Effect.die("not used by model catalog"),
		}),
	);
	const runtime = ManagedRuntime.make(
		ModelCatalogServiceLive.pipe(Layer.provideMerge(dependencies)),
	);
	try {
		const catalog = await runtime.runPromise(ModelCatalogService);
		const current = await runtime.runPromise(
			catalog.refresh({ live: ["zuse"] }),
		);
		expect(current.providers.zuse.live.status).toBe("ok");
		expect(
			current.providers.zuse.models.filter((m) => m.available).map((m) => m.id),
		).toEqual(
			expect.arrayContaining([
				"chatgpt/gpt-6.1-sol",
				"supergrok/grok-code-fast-1",
			]),
		);
		expect(
			current.providers.zuse.models
				.filter((m) => m.available)
				.every((m) => !m.supportsPlanMode),
		).toBe(true);
		connected = false;
		await runtime.runPromise(catalog.invalidateLive("zuse"));
		const disconnected = await runtime.runPromise(
			catalog.refresh({ live: ["zuse"] }),
		);
		expect(
			disconnected.providers.zuse.models.filter((m) => m.available),
		).toEqual([]);
	} finally {
		await runtime.dispose();
		vi.unstubAllEnvs();
		await rm(dir, { recursive: true, force: true });
	}
});
