import { Schema } from "effect";
import { expect, it } from "vitest";
import { BUILTIN_PROVIDER_CHOICES, ProviderId } from "../../src/agent.ts";
import { BUNDLED_MODEL_CATALOG } from "../../src/model-catalog/bundled.ts";
import {
	catalogProviderIds,
	selectableCatalogProviderIds,
} from "../../src/model-catalog/helpers.ts";

it("keeps legacy Gemini histories readable while offering it through ACP for new setup", () => {
	expect(Schema.decodeUnknownSync(ProviderId)("gemini")).toBe("gemini");
	expect(catalogProviderIds(BUNDLED_MODEL_CATALOG)).toContain("gemini");
	expect(BUILTIN_PROVIDER_CHOICES).not.toContain("gemini");
	expect(selectableCatalogProviderIds(BUNDLED_MODEL_CATALOG)).not.toContain(
		"gemini",
	);
	const catalog = {
		...BUNDLED_MODEL_CATALOG,
		providers: {
			...BUNDLED_MODEL_CATALOG.providers,
			"acp-gemini": { models: [], aliases: {} },
		},
	};
	expect(selectableCatalogProviderIds(catalog)).toContain("acp-gemini");
});
