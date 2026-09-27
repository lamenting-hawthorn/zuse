import "@zuse/i18n/english/chat";
import type { ChatRef } from "@zuse/client-runtime/resource-ref";
import { useMessages } from "@zuse/i18n/react";
import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { useAuth } from "../hooks/use-auth.ts";
import { useCloudChatCatalogStore } from "../lib/cloud-workspace-catalog.ts";
import { useEnvironmentChat } from "../lib/environment-entity-hooks.ts";
import {
	rendererWorkspaceSnapshot,
	subscribeRendererWorkspace,
} from "../lib/renderer-workspace.ts";
import { Button } from "./ui/button.tsx";

const WorkspaceSharingDialog = lazy(
	() => import("./workspace-sharing-dialog.tsx"),
);
const CloudChatSharingDialog = lazy(
	() => import("./cloud-chat-sharing-dialog.tsx"),
);

export function WorkspaceSharingButton({
	chatRef,
}: {
	readonly chatRef: ChatRef;
}) {
	const { message } = useMessages(["chat"]);
	const auth = useAuth();
	const chat = useEnvironmentChat(chatRef);
	const workspace = useSyncExternalStore(
		subscribeRendererWorkspace,
		rendererWorkspaceSnapshot,
		rendererWorkspaceSnapshot,
	);
	const cloud = useCloudChatCatalogStore((state) =>
		state.summaries.find(
			(summary) =>
				summary.workspaceId === chatRef.environmentId &&
				summary.chatId === chatRef.chatId,
		),
	);
	const organizationId =
		cloud?.workspaceScope?.kind === "organization"
			? cloud.workspaceScope.organizationId
			: undefined;
	const [open, setOpen] = useState(false);
	if (
		!auth.isSignedIn ||
		chat === null ||
		(chat.readOnly === true && organizationId === undefined)
	)
		return null;
	if (
		workspace.scope.kind === "organization" &&
		workspace.scope.organizationId !== organizationId
	)
		return null;
	if (organizationId !== undefined && workspace.scope.kind !== "organization")
		return null;
	return (
		<>
			<Button
				className="h-7"
				size="xs"
				variant="ghost"
				onClick={() => setOpen(true)}
			>
				{message("chat:workspace_sharing_button")}
			</Button>
			{open && (
				<Suspense fallback={null}>
					{organizationId !== undefined ? (
						<CloudChatSharingDialog
							key={`${chatRef.environmentId}:${auth.user?.id}:${workspace.epoch}`}
							workspaceId={chatRef.environmentId}
							organizationId={organizationId}
							onClose={() => setOpen(false)}
						/>
					) : (
						<WorkspaceSharingDialog
							key={`${chatRef.environmentId}:${chatRef.chatId}:${auth.user?.id}`}
							chatRef={chatRef}
							onClose={() => setOpen(false)}
						/>
					)}
				</Suspense>
			)}
		</>
	);
}
