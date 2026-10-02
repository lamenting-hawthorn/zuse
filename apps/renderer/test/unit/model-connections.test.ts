import { type ModelConnection, ModelConnectionError } from "@zuse/contracts";
import { Effect, Stream } from "effect";
import { expect, it } from "vitest";
import {
	ModelConnectionController,
	type ModelConnectionsClient,
} from "../../src/lib/model-connections.ts";

const connection: ModelConnection = {
	id: "one",
	clientId: "issued",
	name: "Personal",
	email: "same@example.com",
	status: "connected",
	authorized: true,
	preferred: false,
	createdAt: 1,
	planNoticeSeen: false,
};
function fixture() {
	let rows: ModelConnection[] = [];
	let finalized = false;
	const client: ModelConnectionsClient = {
		"modelConnections.connections": () =>
			Effect.sync(() => ({ available: true, connections: rows })),
		"modelConnections.connect": () =>
			Stream.concat(
				Stream.make({
					_tag: "url" as const,
					url: "https://auth.openai.com/api/accounts/authorize?state=test",
				}),
				Stream.fromEffect(
					Effect.sync(() => {
						rows = [connection];
						return { _tag: "connected" as const, connection };
					}),
				),
			),
		"modelConnections.rename": ({ connectionId, name }) =>
			Effect.sync(() => {
				rows = rows.map((row) =>
					row.id === connectionId ? { ...row, name } : row,
				);
			}),
		"modelConnections.preferred": ({ connectionId }) =>
			Effect.sync(() => {
				rows = rows.map((row) => ({
					...row,
					preferred: row.id === connectionId,
				}));
			}),
		"modelConnections.disconnect": ({ connectionId }) =>
			Effect.sync(() => {
				rows = rows.map((row) =>
					row.id === connectionId
						? { ...row, status: "disconnected" as const, authorized: false }
						: row,
				);
				return { revoked: false };
			}),
		"modelConnections.acknowledgePlan": ({ connectionId }) =>
			Effect.sync(() => {
				rows = rows.map((row) =>
					row.id === connectionId ? { ...row, planNoticeSeen: true } : row,
				);
			}),
	};
	const opened: string[] = [];
	const controller = new ModelConnectionController(
		async () => client,
		(url) => {
			opened.push(url);
		},
	);
	return {
		client,
		controller,
		opened,
		finalized: () => finalized,
		finalize: () => {
			finalized = true;
		},
	};
}
it("opens the system browser, manages account metadata, and acknowledges plan use once", async () => {
	const { controller, opened } = fixture();
	await controller.load();
	await controller.connect();
	expect(opened).toHaveLength(1);
	expect(controller.snapshot().connections).toHaveLength(1);
	expect(controller.snapshot().noticeConnectionId).toBe("one");
	await controller.acknowledgePlan();
	await controller.load();
	expect(controller.snapshot().noticeConnectionId).toBeNull();
	await controller.rename("one", "Work");
	await controller.preferred("one");
	expect(controller.snapshot().connections[0]).toMatchObject({
		name: "Work",
		preferred: true,
	});
	await controller.disconnect("one");
	expect(controller.snapshot().warning).toBe("revocation_unconfirmed");
	expect(controller.snapshot().connections[0]?.authorized).toBe(false);
	controller.dispose();
});
it("cancels before client acquisition without later opening a browser", async () => {
	const { client } = fixture();
	let release: (client: ModelConnectionsClient) => void = () => {};
	const pending = new Promise<ModelConnectionsClient>((resolve) => {
		release = resolve;
	});
	const opened: string[] = [];
	const controller = new ModelConnectionController(
		() => pending,
		(url) => {
			opened.push(url);
		},
	);
	const operation = controller.connect();
	controller.cancel();
	release(client);
	await operation;
	expect(opened).toEqual([]);
	expect(controller.snapshot().busy).toBeNull();
	expect(controller.snapshot().error).toBeNull();
	controller.dispose();
});
it("cancels an active stream and does not replay login after a reconnect", async () => {
	const f = fixture();
	f.client["modelConnections.connect"] = () =>
		Stream.concat(
			Stream.make({
				_tag: "url" as const,
				url: "https://auth.openai.com/api/accounts/authorize?state=test",
			}),
			Stream.fromEffect(Effect.never),
		).pipe(Stream.ensuring(Effect.sync(f.finalize)));
	const run = f.controller.connect();
	await expect.poll(() => f.opened.length).toBe(1);
	f.controller.cancel();
	await run;
	expect(f.finalized()).toBe(true);
	expect(f.opened).toHaveLength(1);
	expect(f.controller.snapshot().signingIn).toBe(false);
	f.controller.dispose();
});
it("retains typed denial errors without leaking transport messages", async () => {
	const f = fixture();
	f.client["modelConnections.connect"] = () =>
		Stream.fail(new ModelConnectionError({ code: "access_denied" }));
	await f.controller.connect();
	expect(f.controller.snapshot().error).toBe("access_denied");
	expect(f.opened).toEqual([]);
	f.controller.dispose();
});
it("rejects token-bearing or unexpected browser destinations", async () => {
	const f = fixture();
	f.client["modelConnections.connect"] = () =>
		Stream.make({
			_tag: "url" as const,
			url: "https://auth.openai.com/api/accounts/authorize?id_token_hint=secret",
		});
	await f.controller.connect();
	expect(f.opened).toEqual([]);
	expect(f.controller.snapshot().error).toBe("connection_failed");
	f.controller.dispose();
});

it("shows device codes without opening a browser automatically and sends the selected account scope", async () => {
	const f = fixture();
	let supplied: unknown;
	let opened = false;
	f.client["modelConnections.connect"] = (input) => {
		supplied = input;
		return Stream.concat(
			Stream.make({
				_tag: "device" as const,
				userCode: "TEST-1234",
				verificationUrl: "https://accounts.x.ai/device",
				expiresAt: Date.now() + 60000,
			}),
			Stream.never,
		);
	};
	const controller = new ModelConnectionController(
		async () => f.client,
		() => {
			opened = true;
		},
	);
	const pending = controller.connect(undefined, "supergrok", "account");
	await expect
		.poll(() => controller.snapshot().device?.userCode)
		.toBe("TEST-1234");
	expect(supplied).toMatchObject({ provider: "supergrok", storage: "account" });
	expect(opened).toBe(false);
	controller.cancel();
	await pending;
	expect(controller.snapshot().device).toBeNull();
	controller.dispose();
});

it("refreshes global metadata after sign-in with no mounted subscribers", async () => {
	const { client } = fixture();
	let refreshes = 0;
	const controller = new ModelConnectionController(
		async () => client,
		() => {},
		async () => {
			refreshes++;
		},
	);
	const unsubscribe = controller.subscribe(() => {});
	unsubscribe();
	await controller.connect();
	expect(refreshes).toBe(1);
	expect(controller.snapshot().connections).toHaveLength(1);
	controller.dispose();
});
