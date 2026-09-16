import { ChatId, EnvironmentId } from "@zuse/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	isSignedIn: true,
	chat: null as { readOnly?: boolean } | null,
}));
vi.mock("../../src/hooks/use-auth.ts", () => ({ useAuth: () => state }));
vi.mock("../../src/lib/environment-entity-hooks.ts", () => ({
	useEnvironmentChat: () => state.chat,
}));

import { WorkspaceSharingButton } from "../../src/components/workspace-sharing-button.tsx";

it.each([
	{ isSignedIn: true, chat: { readOnly: true }, visible: false },
	{ isSignedIn: true, chat: null, visible: false },
	{ isSignedIn: false, chat: {}, visible: false },
	{ isSignedIn: true, chat: {}, visible: true },
])("shows sharing only for a signed-in writable chat: %j", (input) => {
	state.isSignedIn = input.isSignedIn;
	state.chat = input.chat;
	const markup = renderToStaticMarkup(
		<WorkspaceSharingButton
			chatRef={{
				environmentId: EnvironmentId.make("remote"),
				chatId: ChatId.make("shared"),
			}}
		/>,
	);
	expect(markup.includes("<button")).toBe(input.visible);
});
