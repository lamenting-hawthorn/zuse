import { AcpAuthMethod, AcpModel } from "@zuse/contracts";
import { Schema } from "effect";

export const AcpInitialize = Schema.Struct({
	protocolVersion: Schema.Number,
	authMethods: Schema.optional(Schema.Array(AcpAuthMethod)),
	agentCapabilities: Schema.optional(
		Schema.Struct({
			loadSession: Schema.optional(Schema.Boolean),
			mcpCapabilities: Schema.optional(
				Schema.Struct({
					http: Schema.optional(Schema.Boolean),
					sse: Schema.optional(Schema.Boolean),
				}),
			),
			promptCapabilities: Schema.optional(
				Schema.Struct({
					image: Schema.optional(Schema.Boolean),
					embeddedContext: Schema.optional(Schema.Boolean),
				}),
			),
		}),
	),
});
const ConfigChoice = Schema.Struct({
	value: Schema.String,
	name: Schema.String,
});
const ConfigOptions = Schema.Array(
	Schema.Struct({
		id: Schema.String,
		name: Schema.String,
		category: Schema.optional(Schema.String),
		type: Schema.String,
		currentValue: Schema.String,
		options: Schema.Array(
			Schema.Union([
				ConfigChoice,
				Schema.Struct({
					group: Schema.String,
					name: Schema.String,
					options: Schema.Array(ConfigChoice),
				}),
			]),
		),
	}),
);
export const AcpSessionResult = Schema.Struct({
	sessionId: Schema.optional(Schema.String),
	configOptions: Schema.optional(ConfigOptions),
	models: Schema.optional(
		Schema.Struct({
			currentModelId: Schema.String,
			availableModels: Schema.Array(
				Schema.Struct({ modelId: Schema.String, name: Schema.String }),
			),
		}),
	),
	modes: Schema.optional(
		Schema.Struct({
			currentModeId: Schema.String,
			availableModes: Schema.Array(AcpModel),
		}),
	),
});
export const initializeAcp = async (
	request: (method: string, params: unknown) => Promise<unknown>,
) => {
	const result = Schema.decodeUnknownSync(AcpInitialize)(
		await request("initialize", {
			protocolVersion: 1,
			clientInfo: { name: "zuse", version: "1" },
			clientCapabilities: {
				fs: { readTextFile: true, writeTextFile: true },
				terminal: true,
				auth: { terminal: true },
			},
		}),
	);
	if (result.protocolVersion !== 1)
		throw new Error(
			`Unsupported ACP protocol version: ${result.protocolVersion}`,
		);
	return result;
};
export const decodeAcpSession = (
	raw: unknown,
	resumeCursor?: string | null,
) => {
	const result = Schema.decodeUnknownSync(AcpSessionResult)(raw);
	if (resumeCursor && result.sessionId && result.sessionId !== resumeCursor)
		throw new Error("ACP agent returned a different session while resuming");
	const sessionId = result.sessionId ?? resumeCursor;
	if (!sessionId)
		throw new Error("ACP session response did not include a session ID");
	return { ...result, sessionId };
};

export const acpSessionInventory = (session: typeof AcpSessionResult.Type) => {
	const modelConfig = session.configOptions?.find(
		(option) => option.category === "model",
	);
	const modeConfig = session.configOptions?.find(
		(option) => option.category === "mode",
	);
	const choices = (config: NonNullable<typeof modelConfig>) =>
		config.options
			.flatMap((option) => ("options" in option ? option.options : [option]))
			.map((option) => ({ id: option.value, name: option.name }));
	return {
		models: modelConfig
			? choices(modelConfig)
			: (session.models?.availableModels.map((model) => ({
					id: model.modelId,
					name: model.name,
				})) ?? []),
		modes: modeConfig
			? choices(modeConfig)
			: (session.modes?.availableModes ?? []),
		currentModelId: modelConfig?.currentValue ?? session.models?.currentModelId,
		currentModeId: modeConfig?.currentValue ?? session.modes?.currentModeId,
		modelConfigId: modelConfig?.id,
		modeConfigId: modeConfig?.id,
	};
};
