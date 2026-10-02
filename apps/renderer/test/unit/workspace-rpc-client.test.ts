import { WORKSPACE_SCOPE_HEADER } from "@zuse/contracts";
import { Effect, Stream } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import { expect, it } from "vitest";
import { withWorkspaceScope } from "../../src/lib/workspace-rpc-client.ts";

const client = {
	read: () => RpcClient.CurrentHeaders,
	watch: () => Stream.fromEffect(RpcClient.CurrentHeaders),
};

it("binds reads and lazy streams to their captured workspace", async () => {
	const scoped = withWorkspaceScope(client, {
		kind: "organization",
		organizationId: "org_a",
	});
	expect((await Effect.runPromise(scoped.read()))[WORKSPACE_SCOPE_HEADER]).toBe(
		"organization:org_a",
	);
	const frames = await Effect.runPromise(Stream.runCollect(scoped.watch()));
	expect(frames[0]?.[WORKSPACE_SCOPE_HEADER]).toBe("organization:org_a");
	expect(scoped.read).toBe(scoped.read);
});

it("does not let caller headers redirect an already bound workspace", async () => {
	const scoped = withWorkspaceScope(client, { kind: "personal" });
	const headers = await Effect.runPromise(
		scoped.read().pipe(
			RpcClient.withHeaders({
				[WORKSPACE_SCOPE_HEADER]: "organization:org_b",
			}),
		),
	);
	expect(headers[WORKSPACE_SCOPE_HEADER]).toBe("personal");
});
