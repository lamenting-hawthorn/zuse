import {
	type ClientCommand,
	CommandAuthorityLostError,
} from "@zuse/client-runtime/client-persistence";
import { CommandId, EnvironmentId } from "@zuse/contracts";
import { expect, it } from "vitest";
import {
	observeRendererAccount,
	type RendererAccountSnapshot,
	rendererAccountSnapshot,
} from "../../src/lib/renderer-account.ts";
import { createRendererCommandAuthority } from "../../src/lib/renderer-command-authority.ts";

const command: ClientCommand = {
	kind: "test",
	commandId: CommandId.make("command"),
	environmentId: EnvironmentId.make("environment"),
	resource: null,
	payload: {},
	retry: "safe",
	createdAt: 1,
};

it("captures the signed-in owner and refuses unowned or foreign account replay", () => {
	observeRendererAccount("first");
	const account = rendererAccountSnapshot();
	const policy = createRendererCommandAuthority(() => account);
	const owner = policy.commandOwnerFor(command);
	expect(owner).toEqual({ kind: "account", subject: "first" });
	expect(policy.commandScopeFor(command)()).toBe(false);
	expect(
		policy.commandScopeFor({
			...command,
			owner: { kind: "account", subject: "second" },
		})(),
	).toBe(false);
	const current = policy.commandScopeFor({ ...command, owner });
	expect(current()).toBe(true);
	observeRendererAccount("second");
	observeRendererAccount("first");
	expect(current()).toBe(false);
	expect(() => policy.commandOwnerFor(command)).toThrow(
		CommandAuthorityLostError,
	);
});

it("retains legacy device commands without allowing them onto account routes", () => {
	let authority: "device" | RendererAccountSnapshot | undefined = "device";
	const policy = createRendererCommandAuthority(() => authority);
	const legacy = policy.commandScopeFor(command);
	expect(policy.commandOwnerFor(command)).toEqual({ kind: "device" });
	observeRendererAccount(null);
	expect(legacy()).toBe(true);
	expect(
		policy.commandScopeFor({
			...command,
			owner: { kind: "account", subject: "first" },
		})(),
	).toBe(false);
	observeRendererAccount("first");
	authority = rendererAccountSnapshot();
	expect(legacy()).toBe(false);
	expect(
		policy.commandScopeFor({ ...command, owner: { kind: "device" } })(),
	).toBe(false);
	authority = undefined;
	expect(() => policy.commandOwnerFor(command)).toThrow(
		CommandAuthorityLostError,
	);
	expect(policy.commandScopeFor(command)()).toBe(false);
});

it("does not create account-owned work while signed out", () => {
	observeRendererAccount(null);
	const policy = createRendererCommandAuthority(rendererAccountSnapshot);
	expect(() => policy.commandOwnerFor(command)).toThrow(
		CommandAuthorityLostError,
	);
});
