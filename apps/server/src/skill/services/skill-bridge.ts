import type {
	FolderId,
	ProviderId,
	SessionId,
	SessionNotFoundError,
	Skill,
	SkillConfigError,
} from "@zuse/contracts";
import { Context, type Effect, type Stream } from "effect";

/**
 * Per-session skill listing, plus a live feed that re-emits the full list
 * when discovery refreshes. Mirrors `messages.stream` semantics so the
 * renderer wires through the same Fiber pattern.
 */
export interface SkillBridgeShape {
	readonly list: (
		sessionId: SessionId,
	) => Effect.Effect<ReadonlyArray<Skill>, SessionNotFoundError>;

	readonly listForProject: (
		projectId: FolderId,
		providerId: ProviderId,
	) => Effect.Effect<ReadonlyArray<Skill>>;

	readonly stream: (
		sessionId: SessionId,
	) => Stream.Stream<ReadonlyArray<Skill>, SessionNotFoundError>;

	/** User-level skills of every skill-capable provider. */
	readonly listGlobal: () => Effect.Effect<ReadonlyArray<Skill>>;

	/**
	 * Persist a toggle, then republish every cached list of that provider so
	 * open composers update. Resolves to the effective enabled state.
	 */
	readonly setEnabled: (input: {
		readonly providerId: ProviderId;
		readonly name: string;
		readonly enabled: boolean;
	}) => Effect.Effect<
		{
			readonly providerId: ProviderId;
			readonly name: string;
			readonly enabled: boolean;
		},
		SkillConfigError
	>;
}

export class SkillBridge extends Context.Service<
	SkillBridge,
	SkillBridgeShape
>()("memoize/SkillBridge") {}
