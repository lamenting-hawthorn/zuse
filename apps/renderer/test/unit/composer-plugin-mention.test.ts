import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { composerSnapshotFromInput } from "../../src/composer/input-snapshot.ts";
import { parseComposerInput } from "../../src/composer/segment-parser.ts";
import {
	addChipEffect,
	chipExtensions,
} from "../../src/lib/codemirror/composer-chips.ts";
import { pluginToolAddress } from "../../src/lib/connected-plugins.ts";

const meta = {
	kind: "plugin",
	pluginId: "linear",
	name: "Linear",
	domain: "linear.app",
} as const;

describe("@plugin mentions", () => {
	it("tell the agent which plugin to use, once per plugin", () => {
		const doc = "Ask @Linear and @Linear about open bugs";
		let state = EditorState.create({ doc, extensions: chipExtensions });
		for (const from of [4, 16])
			state = state.update({
				effects: addChipEffect.of({ from, to: from + 7, meta }),
			}).state;

		const input = parseComposerInput(state, "codex");

		expect(input.text).toBe(doc);
		expect(input.annotations).toHaveLength(1);
		expect(input.annotations[0]).toMatchObject({
			_tag: "context",
			id: "plugin:linear",
			label: "Linear",
		});
		const comment =
			"comment" in (input.annotations[0] ?? {})
				? String((input.annotations[0] as { comment: string }).comment)
				: "";
		expect(comment).toContain("plugins_search");
		expect(comment).toContain('"tools.linear."');

		// Editing a queued message restores the mention as a chip.
		const snapshot = composerSnapshotFromInput(input);
		expect(snapshot.chips.map((chip) => chip.meta)).toContainEqual({
			...meta,
			domain: "",
		});
	});
});

describe("plugin tool addresses", () => {
	it("name the plugin behind an agent's tool call", () => {
		expect(pluginToolAddress("tools.linear.user.c123.list_issues")).toEqual({
			pluginId: "linear",
			tool: "list_issues",
		});
		expect(pluginToolAddress("tools.linear")).toBeNull();
		expect(pluginToolAddress("")).toBeNull();
	});
});
