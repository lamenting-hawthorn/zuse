import {
	decodeWorkspaceGatewayFrame,
	encodeWorkspaceGatewayFrame,
	type WorkspaceGatewayFrameDirection,
} from "@zuse/contracts";
import { describe, expect, it } from "vitest";
import { makeCloudWorkspaceRpcActivity } from "../../src/api/cloud-workspace-activity.ts";

const request = (tag: string) => ({
	_tag: "Request",
	id: "1",
	tag,
	payload: {},
});

describe("cloud workspace RPC activity", () => {
	it("lets a connected idle workspace reach its deadline despite background traffic", () => {
		let now = 0;
		let deadline = 600_000;
		const observe = makeCloudWorkspaceRpcActivity(() => {
			deadline = now + 600_000;
		});
		const relay = (
			direction: WorkspaceGatewayFrameDirection,
			message: unknown,
		) => {
			const payload = JSON.stringify(message);
			const frame = decodeWorkspaceGatewayFrame(
				encodeWorkspaceGatewayFrame({
					direction,
					connectionId: "idle-client",
					payload,
				}),
			);
			if (frame === null) throw new Error("invalid test frame");
			observe(frame);
			expect(frame.payload).toBe(payload);
		};
		for (now = 0; now <= 660_000; now += 10_000) {
			relay("client", { _tag: "Ping" });
			relay("runtime", { _tag: "Pong" });
			for (const tag of [
				"git.status",
				"pty.list",
				"pty.output",
				"session.events",
				"fs.watchTree",
				"chat.markRead",
				"pty.resize",
				"diagnostics.overview",
			]) {
				relay("client", request(tag));
			}
			relay("client", { _tag: "Ack", requestId: "1" });
			relay("runtime", { _tag: "Chunk", requestId: "1", values: ["update"] });
			relay("runtime", {
				_tag: "Exit",
				requestId: "1",
				exit: { _tag: "Success" },
			});
		}
		expect(deadline).toBe(600_000);
		expect(now).toBeGreaterThan(deadline);
	});

	it.each([
		"messages.send",
		"session.answerQuestion",
		"permission.decide",
		"pty.write",
		"fs.writeFile",
		"git.commit",
		"worktree.startRun",
	])("extends activity for %s in text, binary, and batched requests", (tag) => {
		let calls = 0;
		const observe = makeCloudWorkspaceRpcActivity(() => {
			calls++;
		});
		const message = request(tag);
		for (const payload of [
			JSON.stringify(message),
			new TextEncoder().encode(JSON.stringify(message)).buffer,
			JSON.stringify([{ _tag: "Ping" }, message, message]),
		]) {
			observe({ direction: "client", payload });
		}
		expect(calls).toBe(3);
		observe({ direction: "runtime", payload: JSON.stringify(message) });
		expect(calls).toBe(3);
	});

	it("ignores invalid or unknown requests without breaking forwarding", () => {
		let calls = 0;
		const observe = makeCloudWorkspaceRpcActivity(() => {
			calls++;
		});
		for (const payload of [
			"{",
			"null",
			"42",
			"[]",
			JSON.stringify(request("unknown.write")),
			JSON.stringify({ tag: "pty.write" }),
		]) {
			expect(() => observe({ direction: "client", payload })).not.toThrow();
		}
		expect(calls).toBe(0);
	});
});
