import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	WorkspaceSettings,
	WorkspaceSettingsUpdate,
} from "../../src/settings.ts";

const legacyValues = {
	defaultModelByProvider: { claude: "custom-model" },
	providerEnabled: { claude: false },
	modelEnabledByProvider: { claude: { "custom-model": false } },
	customModelIdsByProvider: { claude: ["custom-model"] },
};

describe("workspace settings across provider additions", () => {
	it("reads saved preferences without requiring newly introduced providers", () => {
		expect(
			Schema.decodeUnknownSync(WorkspaceSettings)({
				revision: 3,
				values: legacyValues,
			}),
		).toEqual({ revision: 3, values: legacyValues });
	});
	it("accepts the same sparse preferences on update", () => {
		expect(
			Schema.decodeUnknownSync(WorkspaceSettingsUpdate)({
				expectedRevision: 3,
				values: legacyValues,
			}),
		).toEqual({ expectedRevision: 3, values: legacyValues });
	});
	it("still rejects invalid provider preference values", () => {
		expect(() =>
			Schema.decodeUnknownSync(WorkspaceSettings)({
				revision: 3,
				values: { providerEnabled: { claude: "yes" } },
			}),
		).toThrow();
	});
});
