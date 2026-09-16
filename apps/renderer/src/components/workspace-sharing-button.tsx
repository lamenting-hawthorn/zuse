import "@zuse/i18n/english/chat";
import type { ChatRef } from "@zuse/client-runtime/resource-ref";
import { useMessages } from "@zuse/i18n/react";
import { lazy, Suspense, useState } from "react";
import { useAuth } from "../hooks/use-auth.ts";
import { useEnvironmentChat } from "../lib/environment-entity-hooks.ts";
import { Button } from "./ui/button.tsx";

const WorkspaceSharingDialog = lazy(
	() => import("./workspace-sharing-dialog.tsx"),
);

export function WorkspaceSharingButton({
	chatRef,
}: {
	readonly chatRef: ChatRef;
}) {
	const { message } = useMessages(["chat"]);
	const auth = useAuth();
	const chat = useEnvironmentChat(chatRef);
	const [open, setOpen] = useState(false);
	if (!auth.isSignedIn || chat === null || chat.readOnly === true) return null;
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
					<WorkspaceSharingDialog
						key={`${chatRef.environmentId}:${chatRef.chatId}:${auth.user?.id}`}
						chatRef={chatRef}
						onClose={() => setOpen(false)}
					/>
				</Suspense>
			)}
		</>
	);
}
