import { ChatId, FolderId, SessionId } from "@zuse/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeRendererAccount } from "../../src/lib/renderer-account.ts";
import { selectRendererWorkspace } from "../../src/lib/renderer-workspace.ts";
import { startWorkspaceNavigation } from "../../src/lib/workspace-navigation.ts";
import { useChatsStore } from "../../src/store/chats.ts";
import { useEnvironmentCatalogStore } from "../../src/store/environment-catalog.ts";
import { useSessionsStore } from "../../src/store/sessions.ts";
import { useUiStore } from "../../src/store/ui.ts";
import { useWorkspaceStore } from "../../src/store/workspace.ts";

const environment = vi.hoisted(() => ({ current: "local" }));
vi.mock("../../src/lib/rpc-client.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/lib/rpc-client.ts")>()),
	getActiveEnvironment: () => environment.current,
}));

vi.mock(
	"../../src/lib/environment-shell-client-bus.ts",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("../../src/lib/environment-shell-client-bus.ts")
		>()),
		dispatchEnvironmentShellCommand: vi.fn(() => new Promise(() => {})),
	}),
);

let stop: () => void;
const select = (organizationId: string) =>
	selectRendererWorkspace({ kind: "organization", organizationId });
const stage = (name: string) => {
	const folderId = FolderId.make(name);
	const chatId = ChatId.make(`${name}-chat`);
	const sessionId = SessionId.make(`${name}-session`);
	useChatsStore.setState({
		selectedChatId: chatId,
		selectedChatByProject: { [folderId]: chatId },
	});
	useSessionsStore.setState({
		selectedSessionId: sessionId,
		selectedSessionByProject: { [folderId]: sessionId },
	});
	useWorkspaceStore.setState({ selectedFolderId: folderId });
	useUiStore.setState({
		activeMainTab: "file",
		openFile: { kind: "external", absPath: `/${name}.ts`, name, view: "edit" },
		settingsSection: { kind: "cloud", page: "image" },
	});
};
beforeEach(() => {
	environment.current = "local";
	observeRendererAccount("alice");
	selectRendererWorkspace({ kind: "personal" });
	stage("personal");
	stop = startWorkspaceNavigation();
});
afterEach(() => {
	stop();
	vi.restoreAllMocks();
});

describe("workspace navigation", () => {
	it("refuses to activate a Personal device from an organization", async () => {
		select("a");
		await expect(
			useEnvironmentCatalogStore.getState().activate("local-device"),
		).rejects.toThrow("another workspace");
		expect(useWorkspaceStore.getState().selectedFolderId).toBeNull();
	});
	it("reactivates the original environment through the existing catalog with a stale-response fence", async () => {
		select("a");
		environment.current = "org-server";
		stage("a");
		let finish = () => {};
		const activate = vi
			.spyOn(useEnvironmentCatalogStore.getState(), "activate")
			.mockImplementation(
				(_id, selection) =>
					new Promise((resolve) => {
						finish = () => {
							if (selection?.isCurrent?.()) environment.current = "local";
							resolve(null);
						};
					}),
			);
		selectRendererWorkspace({ kind: "personal" });
		expect(activate).toHaveBeenCalledWith(
			"local",
			expect.objectContaining({
				folderId: "personal",
				chatId: "personal-chat",
				isCurrent: expect.any(Function),
			}),
		);
		expect(useUiStore.getState().openFile).toBeNull();
		select("b");
		stage("b");
		finish();
		await Promise.resolve();
		expect(environment.current).toBe("org-server");
		expect(useChatsStore.getState().selectedChatId).toBe("b-chat");
		expect(useUiStore.getState().openFile?.name).toBe("b");
		selectRendererWorkspace({ kind: "personal" });
		finish();
		await Promise.resolve();
		expect(useUiStore.getState().openFile?.name).toBe("personal");
	});

	it("restores tabs after a different environment has activated", async () => {
		select("a");
		environment.current = "org-server";
		stage("a");
		vi.spyOn(
			useEnvironmentCatalogStore.getState(),
			"activate",
		).mockImplementation(async (id) => {
			environment.current = id;
			return FolderId.make("personal");
		});
		selectRendererWorkspace({ kind: "personal" });
		await Promise.resolve();
		expect(environment.current).toBe("local");
		expect(useChatsStore.getState().selectedChatId).toBe("personal-chat");
		expect(useUiStore.getState().openFile?.name).toBe("personal");
	});
	it("restores independent chat, file tab, and settings selections across Personal and two organizations", () => {
		select("a");
		expect(useChatsStore.getState().selectedChatId).toBeNull();
		expect(useWorkspaceStore.getState().selectedFolderId).toBeNull();
		expect(useUiStore.getState().openFile).toBeNull();
		stage("a");
		select("b");
		expect(useSessionsStore.getState().selectedSessionId).toBeNull();
		stage("b");
		for (const name of ["a", "b", "personal"]) {
			if (name === "personal") selectRendererWorkspace({ kind: "personal" });
			else select(name);
			expect(useChatsStore.getState().selectedChatId).toBe(`${name}-chat`);
			expect(useSessionsStore.getState().selectedSessionId).toBe(
				`${name}-session`,
			);
			expect(useWorkspaceStore.getState().selectedFolderId).toBe(name);
			expect(useUiStore.getState().openFile?.name).toBe(name);
			expect(useUiStore.getState().activeMainTab).toBe("file");
			expect(useUiStore.getState().settingsSection).toEqual({
				kind: "cloud",
				page: "image",
			});
		}
	});

	it("closes transient overlays and advances draft/landing revisions on every switch", () => {
		const draft = useSessionsStore.getState().draftRevision;
		const landing = useChatsStore.getState().landingRevision;
		useUiStore.setState({ fileSearchOpen: true, chatSwitcherOpen: true });
		select("a");
		selectRendererWorkspace({ kind: "personal" });
		expect(useUiStore.getState().fileSearchOpen).toBe(false);
		expect(useUiStore.getState().chatSwitcherOpen).toBe(false);
		expect(useSessionsStore.getState().draftRevision).toBeGreaterThan(draft);
		expect(useChatsStore.getState().landingRevision).toBeGreaterThan(landing);
	});

	it("does not restore another account's selections", () => {
		select("a");
		stage("a");
		observeRendererAccount("bob");
		expect(useChatsStore.getState().selectedChatId).toBeNull();
		expect(useUiStore.getState().openFile).toBeNull();
		select("a");
		expect(useChatsStore.getState().selectedChatId).toBeNull();
		selectRendererWorkspace({ kind: "personal" });
		expect(useWorkspaceStore.getState().selectedFolderId).toBeNull();
	});
});
