import { Effect, Stream } from "effect";
import { expect, it } from "vitest";
import {
	ChatGPTOAuth,
	type ChatGPTVault,
} from "../../src/harness/chatgpt-oauth.ts";
import { makeModelConnections } from "../../src/harness/connections-service.ts";

function fixture() {
	const vault: ChatGPTVault = {
		read: async () => null,
		write: async () => {},
		list: async () => [],
		hostId: async () => "host",
		lock: async (_id, operation) => operation(),
		readPending: async () => null,
		listPending: async () => [],
		writePending: async () => {},
		removePending: async () => {},
	};
	const auth = new ChatGPTOAuth(vault);
	return { auth, vault, service: makeModelConnections(auth, true) };
}
it("releases the loopback listener when the RPC stream is unsubscribed", async () => {
	const { auth, service } = fixture();
	const events = await Effect.runPromise(
		Stream.runCollect(service.connect().pipe(Stream.take(1))),
	);
	const event = events[0];
	if (event?._tag !== "url") throw new Error("Missing authorization URL");
	const callback = new URL(event.url).searchParams.get("redirect_uri");
	if (!callback) throw new Error("Missing callback");
	await expect(fetch(callback)).rejects.toThrow();
	auth.close();
});
it("rejects concurrent sign-ins and cancellation frees the next attempt", async () => {
	const { auth, service } = fixture();
	const abort = new AbortController();
	let opened = false;
	const first = Effect.runPromise(
		Stream.runForEach(service.connect(), () =>
			Effect.sync(() => {
				opened = true;
			}),
		),
		{ signal: abort.signal },
	);
	void first.catch(() => {});
	await expect.poll(() => opened).toBe(true);
	await expect(
		Effect.runPromise(Stream.runCollect(service.connect())),
	).rejects.toMatchObject({ code: "busy" });
	abort.abort();
	await first.catch(() => {});
	const events = await Effect.runPromise(
		Stream.runCollect(service.connect().pipe(Stream.take(1))),
	);
	expect(events[0]?._tag).toBe("url");
	auth.close();
});
it("disables hosted sign-in and returns sanitized failures instead of vault contents", async () => {
	const { auth, vault, service } = fixture();
	const disabled = makeModelConnections(auth, false);
	expect(await Effect.runPromise(disabled.status())).toEqual({
		available: false,
		connections: [],
	});
	await expect(
		Effect.runPromise(Stream.runCollect(disabled.connect())),
	).rejects.toMatchObject({ code: "unavailable" });
	vault.list = async () => {
		throw new Error("private token contents");
	};
	await expect(Effect.runPromise(service.status())).rejects.toMatchObject({
		code: "storage_failed",
	});
	auth.close();
});
