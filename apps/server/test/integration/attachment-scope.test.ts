import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { AttachmentService } from "@zuse/agents/kernel/attachment-service";
import { SessionId } from "@zuse/contracts";
import { layer as sqliteLayer } from "@zuse/sqlite";
import { Effect, Layer, ManagedRuntime } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { expect, it } from "vitest";
import { AppPaths } from "../../src/app-paths.ts";
import { AttachmentServiceLive } from "../../src/attachment/layers/attachment-service.ts";
import { MigrationsLive } from "../../src/persistence/migrations.ts";

it("does not let an accessible session authorize another session's attachment", async () => {
	const dir = await mkdtemp(join(tmpdir(), "zuse-attachment-scope-"));
	const file = join(dir, "attachment.txt");
	await writeFile(file, "private attachment");
	const sql = sqliteLayer({ filename: ":memory:", disableWAL: true });
	const database = sql.pipe(
		Layer.provideMerge(MigrationsLive.pipe(Layer.provide(sql))),
	);
	const runtime = ManagedRuntime.make(
		AttachmentServiceLive.pipe(
			Layer.provideMerge(database),
			Layer.provide(NodeServices.layer),
			Layer.provide(Layer.succeed(AppPaths, { userData: dir })),
		),
	);
	try {
		await runtime.runPromise(
			Effect.gen(function* () {
				const db = yield* SqlClient.SqlClient;
				yield* db`INSERT INTO attachments (id, session_id, mime_type, size_bytes, original_name, created_at, abs_path)
				VALUES ('attachment_1', 'private-session', 'text/plain', 18, 'attachment.txt', ${new Date().toISOString()}, ${file})`;
				const service = yield* AttachmentService;
				expect(
					yield* service.readForSession(
						SessionId.make("shared-session"),
						"attachment_1",
					),
				).toBeNull();
				expect(
					yield* service.readForSession(
						SessionId.make("private-session"),
						"missing",
					),
				).toBeNull();
				const authorized = yield* service.readForSession(
					SessionId.make("private-session"),
					"attachment_1",
				);
				expect(authorized?.originalName).toBe("attachment.txt");
				expect(new TextDecoder().decode(authorized?.bytes)).toBe(
					"private attachment",
				);
			}),
		);
	} finally {
		await runtime.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
