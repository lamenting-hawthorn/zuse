import { Effect } from "effect";
import { expect, it } from "vitest";
import { acceptWireHandshake } from "../../src/transports/wire-compatibility.ts";

it.each([
	5, 6,
])("accepts and echoes deployed protocol %i", async (protocolVersion) => {
	expect(await Effect.runPromise(acceptWireHandshake(protocolVersion))).toEqual(
		{ protocolVersion, workspaceScopeProtocol: 1 },
	);
});
it.each([
	0,
	4,
	7,
	5.5,
	NaN,
])("rejects unsupported protocol %s", async (version) => {
	const error = await Effect.runPromise(
		Effect.flip(acceptWireHandshake(version)),
	);
	expect(error._tag).toBe("WireProtocolRejected");
});
