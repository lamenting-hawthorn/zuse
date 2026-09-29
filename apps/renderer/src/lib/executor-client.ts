import {
	CommandId,
	EnvironmentId,
	type ExecutorCommand,
	type ExecutorState,
} from "@zuse/contracts";
import { dispatchEnvironmentShellCommand } from "./environment-shell-client-bus.ts";

const request = async (
	environmentId: string,
	kind: string,
	payload: unknown,
): Promise<ExecutorState> => {
	const response = await dispatchEnvironmentShellCommand<
		unknown,
		ExecutorState
	>({
		environmentId: EnvironmentId.make(environmentId),
		kind,
		commandId: CommandId.make(`executor:${crypto.randomUUID()}`),
		payload,
		retry: "never",
	});
	return response.result;
};
export const executorActions = {
	state: (environmentId: string) =>
		request(environmentId, "executor.state", {}),
	execute: (environmentId: string, command: ExecutorCommand) =>
		request(environmentId, "executor.execute", command),
};
