import { describe, expect, it } from "vitest";
import { launchAcpProcess } from "../../src/process.js";

describe("ACP process lifecycle", () => {
	it("rejects pending requests on malformed output", async () => {
		const child = launchAcpProcess(
			{
				command: process.execPath,
				args: [
					"-e",
					'process.stdin.once("data",()=>process.stdout.write("bad-json\\n"))',
				],
			},
			process.cwd(),
			() => {},
		);
		try {
			await expect(child.rpc.request("initialize", {})).rejects.toThrow(
				"malformed",
			);
			expect(child.rpc.pendingCount).toBe(0);
		} finally {
			child.close();
		}
	});
	it("reports early process exit", async () => {
		const child = launchAcpProcess(
			{ command: process.execPath, args: ["-e", "process.exit(42)"] },
			process.cwd(),
			() => {},
		);
		try {
			await expect(child.rpc.request("initialize", {})).rejects.toThrow("42");
		} finally {
			child.close();
		}
	});
	it("bounds unanswered requests and closes idempotently", async () => {
		const child = launchAcpProcess(
			{ command: process.execPath, args: ["-e", "process.stdin.resume()"] },
			process.cwd(),
			() => {},
		);
		await expect(
			child.rpc.request("initialize", {}, { timeoutMs: 30 }),
		).rejects.toThrow("timed out");
		child.close();
		child.close();
		expect(child.rpc.pendingCount).toBe(0);
	});
});
