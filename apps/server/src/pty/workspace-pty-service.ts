import {
	type ChatId,
	PtyOwnerId,
	PtyOwnerMismatchError,
	PtyOwnership,
	PtySpawnError,
} from "@zuse/contracts";
import { Effect, Stream } from "effect";
import type { PtyServiceShape } from "./services/pty-service.ts";

/** Server-established chat scope; caller-supplied owner IDs never confer access. */
export const workspacePtyService = (
	service: PtyServiceShape,
	scope: { readonly chatId: ChatId; readonly cwd: string },
): PtyServiceShape => {
	const ownerId = PtyOwnerId.make(`workspace-terminal:${scope.chatId}`);
	const catalog = service.list(ownerId).pipe(
		Effect.map((value) => ({
			...value,
			terminals: value.terminals.filter(
				(terminal) => terminal.cwd === scope.cwd,
			),
		})),
	);
	const requireTerminal = Effect.fn("workspacePtyService.requireTerminal")(
		function* (ptyId: Parameters<PtyServiceShape["write"]>[0]) {
			const visible = yield* catalog;
			if (!visible.terminals.some((terminal) => terminal.ptyId === ptyId))
				return yield* new PtyOwnerMismatchError({ ptyId });
		},
	);
	return {
		open: (cwd, cols, rows, command, ownership) => {
			if (cwd !== scope.cwd)
				return Effect.fail(
					new PtySpawnError({
						reason: "Terminal directory does not belong to this chat",
					}),
				);
			return service.open(
				cwd,
				cols,
				rows,
				command,
				PtyOwnership.make({
					...ownership,
					ownerId,
					scope: "session",
				}),
			);
		},
		list: () => catalog,
		write: (ptyId, data) =>
			requireTerminal(ptyId).pipe(
				Effect.andThen(() => service.write(ptyId, data, ownerId)),
			),
		resize: (ptyId, cols, rows) =>
			requireTerminal(ptyId).pipe(
				Effect.andThen(() => service.resize(ptyId, cols, rows, ownerId)),
			),
		close: (ptyId) =>
			requireTerminal(ptyId).pipe(
				Effect.andThen(() => service.close(ptyId, ownerId)),
			),
		rename: (ptyId, label) =>
			requireTerminal(ptyId).pipe(
				Effect.andThen(() => service.rename(ptyId, label, ownerId)),
			),
		restart: (ptyId, _owner, expectedProcessEpoch) =>
			requireTerminal(ptyId).pipe(
				Effect.andThen(() =>
					service.restart(ptyId, ownerId, expectedProcessEpoch),
				),
			),
		subscribe: (ptyId, afterSequence, processEpoch) =>
			Stream.unwrap(
				requireTerminal(ptyId).pipe(
					Effect.map(() =>
						service.subscribe(ptyId, afterSequence, processEpoch, ownerId),
					),
				),
			),
		closeOwned: () => service.closeOwned(ownerId),
		closeByCwdPrefix: (cwd) =>
			cwd === scope.cwd
				? service.closeOwned(ownerId).pipe(Effect.asVoid)
				: Effect.void,
	};
};
