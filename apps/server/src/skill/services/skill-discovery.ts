import type { ProviderId, Skill, SkillConfigError } from "@zuse/contracts";
import { Context, type Effect } from "effect";

/**
 * Per-provider skill discovery on disk.
 *
 * The active provider's CLI owns the format and directory layout for skills;
 * this service mirrors what each tool would surface when the user types `/`
 * inside it directly. See the amendment in
 * `specs/0.03-MVP/decisions/0011-skills-via-provider.md` for why we read
 * disk instead of routing through the SDK API for 0.03.
 *
 * Returns a flat `Skill[]` with project-scoped entries first (popover
 * precedence): project skills shadow globals with the same name. Every skill
 * carries its effective `enabled` / `toggleSupported`; disabled skills are
 * still returned so settings can list them — consumers that inject skills
 * into a model must drop them.
 */
export interface SkillDiscoveryServiceShape {
	/** `projectCwd: null` discovers user-level (global) skills only. */
	readonly discover: (
		providerId: ProviderId,
		projectCwd: string | null,
	) => Effect.Effect<ReadonlyArray<Skill>>;

	/**
	 * Persist a skill toggle. Claude/Zuse write the global `disabledSkills`
	 * setting; Codex writes its native skill config. Resolves to the effective
	 * enabled state after the write.
	 */
	readonly setEnabled: (
		providerId: ProviderId,
		name: string,
		enabled: boolean,
	) => Effect.Effect<boolean, SkillConfigError>;
}

export class SkillDiscoveryService extends Context.Service<
	SkillDiscoveryService,
	SkillDiscoveryServiceShape
>()("memoize/SkillDiscoveryService") {}
