import { type ProviderId, Skill } from "@zuse/contracts";
import { describe, expect, it } from "vitest";

import { toggleDisabledKey } from "../../src/config-store/disabled-keys.ts";
import {
	applySkillEnablement,
	claudeSkillAllowlist,
	hasDisabledSkillsFor,
	skillEnablementKey,
} from "../../src/skill/skill-enablement.ts";

const skill = (
	name: string,
	options: {
		readonly providerId?: ProviderId;
		readonly filePath?: string | null;
		readonly enabled?: boolean;
	} = {},
): Skill =>
	Skill.make({
		name,
		scope: "global",
		description: "",
		arguments: [],
		filePath:
			options.filePath === undefined
				? `/home/u/.claude/skills/${name}/SKILL.md`
				: options.filePath,
		providerId: options.providerId ?? "claude",
		...(options.enabled === undefined ? {} : { enabled: options.enabled }),
	});

describe("skill enablement", () => {
	it("keys overrides by provider and name only", () => {
		expect(skillEnablementKey("claude", "pdf")).toBe("claude:pdf");
		expect(skillEnablementKey("claude", "plugin:skill")).toBe(
			"claude:plugin:skill",
		);
	});

	it("stamps Claude/Zuse enablement from disabledSkills and leaves Codex native", () => {
		const result = applySkillEnablement(
			[
				skill("pdf"),
				skill("docx"),
				skill("notes", { providerId: "zuse" }),
				skill("pdf", { providerId: "zuse" }),
				skill("review", { providerId: "codex", enabled: false }),
			],
			["claude:pdf", "zuse:notes", "codex:review-other"],
		);
		expect(
			result.map((s) => [s.providerId, s.name, s.enabled, s.toggleSupported]),
		).toEqual([
			["claude", "pdf", false, true],
			["claude", "docx", true, true],
			["zuse", "notes", false, true],
			["zuse", "pdf", true, true],
			["codex", "review", false, false],
		]);
	});

	it("defaults decoded skills to enabled without toggle support", () => {
		const decoded = skill("pdf");
		expect(decoded.enabled).toBe(true);
		expect(decoded.toggleSupported).toBe(false);
	});

	it("detects disabled keys per provider", () => {
		expect(hasDisabledSkillsFor(["zuse:pdf"], "claude")).toBe(false);
		expect(hasDisabledSkillsFor(["zuse:pdf", "claude:x"], "claude")).toBe(true);
		expect(hasDisabledSkillsFor([], "claude")).toBe(false);
	});
});

describe("claudeSkillAllowlist", () => {
	it("leaves the SDK default when nothing is disabled", () => {
		expect(claudeSkillAllowlist([skill("pdf"), skill("docx")])).toBe(undefined);
		expect(claudeSkillAllowlist([])).toBe(undefined);
	});

	it("lists every enabled skill when any skill is disabled", () => {
		expect(
			claudeSkillAllowlist([
				skill("pdf", { enabled: false }),
				skill("docx"),
				skill("acme:deploy", {
					filePath: "/home/u/.claude/plugins/acme/skills/deploy/SKILL.md",
				}),
			]),
		).toEqual(["docx", "acme:deploy"]);
	});

	it("returns an empty allowlist when every skill is disabled", () => {
		expect(
			claudeSkillAllowlist([
				skill("pdf", { enabled: false }),
				skill("docx", { enabled: false }),
			]),
		).toEqual([]);
	});

	it("adds the directory name when the frontmatter name differs", () => {
		expect(
			claudeSkillAllowlist([
				skill("off", { enabled: false }),
				skill("Pretty Name", {
					filePath: "/home/u/.claude/skills/pretty/SKILL.md",
				}),
				skill("acme:Shown", {
					filePath: "/cache/acme/1.0.0/skills/shown-dir/SKILL.md",
				}),
				skill("legacy", { filePath: "/home/u/.claude/skills/legacy.md" }),
			]),
		).toEqual([
			"Pretty Name",
			"pretty",
			"acme:Shown",
			"acme:shown-dir",
			"legacy",
		]);
	});

	it("never re-allows a disabled skill's name through an alias", () => {
		expect(
			claudeSkillAllowlist([
				skill("blocked", { enabled: false }),
				skill("Display", {
					filePath: "/home/u/.claude/skills/blocked/SKILL.md",
				}),
			]),
		).toEqual(["Display"]);
	});
});

describe("toggleDisabledKey", () => {
	it("adds a key once when disabling and removes it when enabling", () => {
		expect(toggleDisabledKey([], "claude:pdf", false)).toEqual(["claude:pdf"]);
		expect(toggleDisabledKey(["claude:pdf"], "claude:pdf", false)).toEqual([
			"claude:pdf",
		]);
		expect(
			toggleDisabledKey(["a", "claude:pdf", "b"], "claude:pdf", true),
		).toEqual(["a", "b"]);
		expect(toggleDisabledKey(["a"], "claude:pdf", true)).toEqual(["a"]);
	});
});
