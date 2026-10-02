import { Effect, Stream } from "effect";
import { expect, it, vi } from "vitest";
import { gateModelConnections } from "../../src/harness/access.ts";
import type { ModelConnectionsShape } from "../../src/harness/connections-service.ts";

it("checks every operation and blocks previously enabled sessions after account changes", async () => {
	let allowed = false;
	const touched = vi.fn();
	const service: ModelConnectionsShape = {
		status: () =>
			Effect.sync(() => {
				touched();
				return { available: true, connections: [] };
			}),
		credential: () =>
			Effect.sync(() => {
				touched();
				return { connectionId: "one", accessToken: "secret" };
			}),
		connect: () =>
			Stream.fromEffect(
				Effect.sync(() => {
					touched();
					return { _tag: "url" as const, url: "https://auth.openai.com" };
				}),
			),
		rename: () => Effect.sync(touched),
		preferred: () => Effect.sync(touched),
		disconnect: () =>
			Effect.sync(() => {
				touched();
				return { revoked: true };
			}),
		acknowledgePlan: () => Effect.sync(touched),
	};
	const gated = gateModelConnections(
		service,
		Effect.sync(() => allowed),
	);
	expect(await Effect.runPromise(gated.status())).toMatchObject({
		available: false,
		connections: [],
	});
	for (const operation of [
		gated.credential("one"),
		Stream.runCollect(gated.connect()),
		gated.rename("one", "new"),
		gated.preferred("one"),
		gated.disconnect("one"),
		gated.acknowledgePlan("one"),
	]) {
		await expect(Effect.runPromise(operation)).rejects.toMatchObject({
			code: "unavailable",
		});
	}
	expect(touched).not.toHaveBeenCalled();
	allowed = true;
	expect((await Effect.runPromise(gated.status())).available).toBe(true);
	expect((await Effect.runPromise(gated.credential("one"))).accessToken).toBe(
		"secret",
	);
	allowed = false;
	await expect(
		Effect.runPromise(gated.credential("one")),
	).rejects.toMatchObject({ code: "unavailable" });
});
