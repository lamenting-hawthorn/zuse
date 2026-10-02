import { ModelConnectionError } from "@zuse/contracts";
import { Effect, Stream } from "effect";
import type { ModelConnectionsShape } from "./connections-service.ts";

/** Check each operation, so a saved enable toggle never bypasses account rollout. */
export function gateModelConnections(
	service: ModelConnectionsShape,
	allowed: Effect.Effect<boolean>,
): ModelConnectionsShape {
	const requireAccess = allowed.pipe(
		Effect.flatMap((ok) =>
			ok
				? Effect.void
				: Effect.fail(new ModelConnectionError({ code: "unavailable" })),
		),
	);
	return {
		status: () =>
			allowed.pipe(
				Effect.flatMap((ok) =>
					ok
						? service.status()
						: Effect.succeed({
								available: false,
								localAvailable: false,
								accountAvailable: false,
								chatgptAvailable: false,
								supergrokAvailable: false,
								connections: [],
							}),
				),
			),
		credential: (id) =>
			requireAccess.pipe(Effect.flatMap(() => service.credential(id))),
		connect: (...args) =>
			Stream.unwrap(
				requireAccess.pipe(Effect.map(() => service.connect(...args))),
			),
		rename: (...args) =>
			requireAccess.pipe(Effect.flatMap(() => service.rename(...args))),
		preferred: (id) =>
			requireAccess.pipe(Effect.flatMap(() => service.preferred(id))),
		disconnect: (id) =>
			requireAccess.pipe(Effect.flatMap(() => service.disconnect(id))),
		acknowledgePlan: (id) =>
			requireAccess.pipe(Effect.flatMap(() => service.acknowledgePlan(id))),
	};
}
