import { expect, it } from "vitest";
import {
	acpSessionInventory,
	decodeAcpSession,
} from "../../../../src/drivers/acp/discovery.ts";

it("accepts empty load responses while refusing replacement conversation identities", () => {
	expect(decodeAcpSession({}, "saved-session").sessionId).toBe("saved-session");
	expect(() =>
		decodeAcpSession({ sessionId: "different" }, "saved-session"),
	).toThrow("different session");
	expect(() => decodeAcpSession({})).toThrow("session ID");
});
it("discovers grouped model configuration and mode configuration", () => {
	const session = decodeAcpSession({
		sessionId: "s",
		configOptions: [
			{
				id: "model-choice",
				name: "Model",
				category: "model",
				type: "select",
				currentValue: "m",
				options: [
					{
						group: "models",
						name: "Models",
						options: [{ value: "m", name: "Model M" }],
					},
				],
			},
			{
				id: "mode-choice",
				name: "Mode",
				category: "mode",
				type: "select",
				currentValue: "code",
				options: [{ value: "code", name: "Code" }],
			},
		],
	});
	expect(acpSessionInventory(session)).toMatchObject({
		models: [{ id: "m", name: "Model M" }],
		modes: [{ id: "code", name: "Code" }],
		modelConfigId: "model-choice",
		modeConfigId: "mode-choice",
	});
});
