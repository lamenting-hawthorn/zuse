import {
	ChatId,
	PtyId,
	PtyOwnerId,
	PtyOwnership,
	PtySummary,
} from "@zuse/contracts";
import { Effect, Stream } from "effect";
import { expect, it, vi } from "vitest";
import type { PtyServiceShape } from "../../src/pty/services/pty-service.ts";
import { workspacePtyService } from "../../src/pty/workspace-pty-service.ts";

const terminal = PtySummary.make({
	ptyId: PtyId.make("shared-terminal"),
	cwd: "/chat",
	label: null,
	scope: "session",
	status: "running",
	cols: 80,
	rows: 24,
	processEpoch: "epoch",
	latestOutputSequence: 0,
});
const fixture = () => {
	const service: PtyServiceShape = {
		open: vi.fn(() =>
			Effect.succeed({ ptyId: terminal.ptyId, processEpoch: "epoch" }),
		),
		list: vi.fn((ownerId) =>
			Effect.succeed({
				terminals: ownerId === "workspace-terminal:shared" ? [terminal] : [],
				liveLimit: 5,
			}),
		),
		write: vi.fn(() => Effect.void),
		resize: vi.fn(() => Effect.void),
		close: vi.fn(() => Effect.void),
		rename: vi.fn(() => Effect.succeed(terminal)),
		restart: vi.fn(() =>
			Effect.succeed({ ptyId: terminal.ptyId, processEpoch: "next" }),
		),
		subscribe: vi.fn(() => Stream.empty),
		closeOwned: vi.fn(() => Effect.succeed(1)),
		closeByCwdPrefix: vi.fn(() => Effect.void),
	};
	return {
		service,
		scoped: workspacePtyService(service, {
			chatId: ChatId.make("shared"),
			cwd: "/chat",
		}),
	};
};

it("binds catalog and new terminals to the server's chat, not caller ownership", async () => {
	const { service, scoped } = fixture();
	const forged = PtyOwnerId.make("another-chat");
	expect((await Effect.runPromise(scoped.list(forged))).terminals).toEqual([
		terminal,
	]);
	await Effect.runPromise(
		scoped.open(
			"/chat",
			80,
			24,
			undefined,
			PtyOwnership.make({
				ownerId: forged,
				scope: "environment",
				label: "Shell",
			}),
		),
	);
	expect(service.open).toHaveBeenCalledWith(
		"/chat",
		80,
		24,
		undefined,
		expect.objectContaining({
			ownerId: "workspace-terminal:shared",
			scope: "session",
			label: "Shell",
		}),
	);
	await expect(
		Effect.runPromise(scoped.open("/private", 80, 24)),
	).rejects.toMatchObject({ _tag: "PtySpawnError" });
	expect(service.open).toHaveBeenCalledTimes(1);
});

it("denies all operations on other-chat or unowned host terminals before delegation", async () => {
	const { service, scoped } = fixture();
	const id = PtyId.make("host-terminal");
	const operations = [
		scoped.write(id, "secret"),
		scoped.resize(id, 90, 30),
		scoped.close(id),
		scoped.rename(id, "new"),
		scoped.restart(id),
		Stream.runCollect(scoped.subscribe(id)),
	];
	for (const operation of operations)
		await expect(Effect.runPromise(operation)).rejects.toMatchObject({
			_tag: "PtyOwnerMismatchError",
		});
	for (const method of [
		service.write,
		service.resize,
		service.close,
		service.rename,
		service.restart,
		service.subscribe,
	])
		expect(method).not.toHaveBeenCalled();
});

it("preserves output cursors and restart epochs while fixing the delegated owner", async () => {
	const { service, scoped } = fixture();
	await Effect.runPromise(
		scoped.write(terminal.ptyId, "hello", PtyOwnerId.make("forged")),
	);
	await Effect.runPromise(
		Stream.runCollect(scoped.subscribe(terminal.ptyId, 42, "epoch")),
	);
	await Effect.runPromise(scoped.restart(terminal.ptyId, undefined, "epoch"));
	expect(service.write).toHaveBeenCalledWith(
		terminal.ptyId,
		"hello",
		"workspace-terminal:shared",
	);
	expect(service.subscribe).toHaveBeenCalledWith(
		terminal.ptyId,
		42,
		"epoch",
		"workspace-terminal:shared",
	);
	expect(service.restart).toHaveBeenCalledWith(
		terminal.ptyId,
		"workspace-terminal:shared",
		"epoch",
	);
});

it("limits bulk cleanup to the chat's own terminal catalog", async () => {
	const { service, scoped } = fixture();
	await Effect.runPromise(scoped.closeByCwdPrefix("/"));
	expect(service.closeOwned).not.toHaveBeenCalled();
	await Effect.runPromise(scoped.closeByCwdPrefix("/chat"));
	expect(service.closeOwned).toHaveBeenCalledWith("workspace-terminal:shared");
	expect(service.closeByCwdPrefix).not.toHaveBeenCalled();
});

it("does not retain terminal access after the chat moves to another checkout", async () => {
	const { service } = fixture();
	const moved = workspacePtyService(service, {
		chatId: ChatId.make("shared"),
		cwd: "/new-checkout",
	});
	expect(
		(await Effect.runPromise(moved.list(PtyOwnerId.make("ignored")))).terminals,
	).toEqual([]);
	await expect(
		Effect.runPromise(moved.write(terminal.ptyId, "input")),
	).rejects.toMatchObject({ _tag: "PtyOwnerMismatchError" });
	expect(service.write).not.toHaveBeenCalled();
});
