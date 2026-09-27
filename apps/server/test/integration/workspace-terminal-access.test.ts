import {
	ChatId,
	FolderId,
	PtyId,
	PtyOwnerId,
	PtySummary,
} from "@zuse/contracts";
import { layer as sqliteLayer } from "@zuse/sqlite";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { expect, it, vi } from "vitest";
import { authorizeWorkspaceRpc } from "../../src/lan-auth/layers/workspace-rpc-authorization.ts";
import { PtyService } from "../../src/pty/services/pty-service.ts";

it("scopes terminals to the verified chat, enforces View/Edit and expires output access", async () => {
	const terminal = PtySummary.make({
		ptyId: PtyId.make("terminal"),
		cwd: "/shared",
		label: null,
		scope: "session",
		status: "running",
		cols: 80,
		rows: 24,
		processEpoch: "epoch",
		latestOutputSequence: 0,
	});
	const write = vi.fn(() => Effect.void);
	const service = PtyService.of({
		open: () =>
			Effect.succeed({ ptyId: terminal.ptyId, processEpoch: "epoch" }),
		list: (ownerId) =>
			Effect.succeed({
				terminals: ownerId === "workspace-terminal:shared" ? [terminal] : [],
				liveLimit: 5,
			}),
		write,
		resize: () => Effect.void,
		close: () => Effect.void,
		rename: () => Effect.succeed(terminal),
		restart: () =>
			Effect.succeed({ ptyId: terminal.ptyId, processEpoch: "epoch" }),
		subscribe: () => Stream.never,
		closeOwned: () => Effect.succeed(0),
		closeByCwdPrefix: () => Effect.void,
	});
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			sqliteLayer({ filename: ":memory:", disableWAL: true }),
			Layer.succeed(PtyService, service),
		),
	);
	let permission: "view" | "edit" = "view";
	const identity = {
		kind: "workspace" as const,
		subject: "member",
		membershipId: "membership-member",
		workspaceId: "cloud",
		chatId: ChatId.make("shared"),
		projectId: FolderId.make("project"),
		expiresAt: Date.now() + 60_000,
		authorize: Effect.suspend(() => Effect.succeed(permission)),
	};
	try {
		await runtime.runPromise(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient;
				yield* sql`CREATE TABLE projects (id TEXT, path TEXT)`;
				yield* sql`CREATE TABLE chats (id TEXT, project_id TEXT, worktree_id TEXT)`;
				yield* sql`CREATE TABLE worktrees (id TEXT, project_id TEXT, path TEXT)`;
				yield* sql`INSERT INTO projects VALUES ('project', '/shared')`;
				yield* sql`INSERT INTO chats VALUES ('shared', 'project', NULL)`;
			}),
		);
		const list = Effect.flatMap(PtyService, (pty) =>
			pty.list(PtyOwnerId.make("forged")),
		);
		const catalog = await runtime.runPromise(
			authorizeWorkspaceRpc(list, identity, "pty.list", { ownerId: "forged" }),
		);
		expect(catalog.terminals).toEqual([terminal]);
		const input = Effect.flatMap(PtyService, (pty) =>
			pty.write(terminal.ptyId, "echo hello"),
		);
		await expect(
			runtime.runPromise(
				authorizeWorkspaceRpc(input, identity, "pty.write", {}),
			),
		).rejects.toMatchObject({ _tag: "RpcAccessDeniedError" });
		expect(write).not.toHaveBeenCalled();
		permission = "edit";
		await runtime.runPromise(
			authorizeWorkspaceRpc(input, identity, "pty.write", {}),
		);
		expect(write).toHaveBeenCalledWith(
			terminal.ptyId,
			"echo hello",
			"workspace-terminal:shared",
		);
		const outside = Effect.flatMap(PtyService, (pty) =>
			pty.open("/private", 80, 24),
		);
		await expect(
			runtime.runPromise(
				authorizeWorkspaceRpc(outside, identity, "pty.open", {}),
			),
		).rejects.toMatchObject({ _tag: "PtySpawnError" });
		const output = Effect.flatMap(PtyService, (pty) =>
			Stream.runDrain(pty.subscribe(terminal.ptyId)),
		);
		await expect(
			runtime.runPromise(
				authorizeWorkspaceRpc(
					output,
					{ ...identity, expiresAt: Date.now() + 50 },
					"pty.output",
					{},
				),
			),
		).rejects.toMatchObject({ _tag: "RpcAccessDeniedError" });
		await expect(
			runtime.runPromise(
				authorizeWorkspaceRpc(Effect.void, identity, "pty.closeOwned", {}),
			),
		).rejects.toMatchObject({ _tag: "RpcAccessDeniedError" });
	} finally {
		await runtime.dispose();
	}
});
