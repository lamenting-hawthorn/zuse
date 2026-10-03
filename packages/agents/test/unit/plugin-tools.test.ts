import { expect, test, vi } from "vitest";
import type { LinearPermissionOptions } from "../../src/drivers/linear-tools.ts";
import { handlePluginTool } from "../../src/drivers/plugin-tools.ts";

const args = {
	address: "tools.linear.user.work.update",
	arguments: { title: "Changed" },
};
test("discovery is available but invocation is blocked in plan mode", async () => {
	const request = vi.fn(async () => []);
	const permissions: LinearPermissionOptions = {
		getRuntimeMode: () => "full-access",
		getPermissionMode: () => "plan",
		requestPermission: vi.fn(),
	};
	await handlePluginTool(
		"plugins_search",
		{ query: "issue" },
		{ request },
		permissions,
	);
	await expect(
		handlePluginTool("plugins_call", args, { request }, permissions),
	).rejects.toThrow("plan mode");
	expect(request).toHaveBeenCalledTimes(1);
});
test("denial prevents upstream invocation; approval binds the actual tool arguments", async () => {
	const request = vi.fn(async () => ({ ok: true }));
	const requestPermission = vi.fn<LinearPermissionOptions["requestPermission"]>(
		async () => ({ _tag: "Deny" }),
	);
	const permissions: LinearPermissionOptions = {
		getRuntimeMode: () => "approval-required",
		getPermissionMode: () => "default",
		requestPermission,
	};
	await expect(
		handlePluginTool("plugins_call", args, { request }, permissions),
	).rejects.toThrow("denied");
	expect(request).not.toHaveBeenCalled();
	requestPermission.mockResolvedValue({ _tag: "AllowOnce" });
	await handlePluginTool("plugins_call", args, { request }, permissions);
	expect(request).toHaveBeenCalledWith({ action: "call", ...args });
	expect(requestPermission.mock.calls[0]?.[0]).toMatchObject({
		tool: args.address,
	});
});
