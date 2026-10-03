import { useState } from "react";
import { useAuth } from "~/hooks/use-auth.ts";
import {
	clearPluginConfirmation,
	readPluginConfirmation,
} from "~/lib/plugin-confirmation-storage.ts";
import { pluginRequest } from "~/lib/plugins-client.ts";
import { Button } from "./ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "./ui/dialog.tsx";

export function PluginConfirmation() {
	const { isSignedIn, user } = useAuth();
	const [pending, setPending] = useState(readPluginConfirmation);
	const [busy, setBusy] = useState(false);
	const [completed, setCompleted] = useState(false);
	const [message, setMessage] = useState<string>();
	if (!pending || !isSignedIn) return null;
	const dismiss = () => {
		clearPluginConfirmation();
		setPending(null);
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) dismiss();
			}}
		>
			<DialogContent
				showCloseButton={false}
				className="max-w-sm p-5 dark:border-0"
			>
				<DialogTitle className="text-sm font-medium">
					Confirm plugin connection
				</DialogTitle>
				<DialogDescription className="mt-2 text-xs leading-5 text-muted-foreground">
					Connect the service you just authorized to {user?.email}. Confirm only
					if you started this connection in Zuse.
				</DialogDescription>
				{message && (
					<p role="status" className="mt-3 text-xs">
						{message}
					</p>
				)}
				<div className="mt-4 flex justify-end gap-2">
					<Button
						variant="ghost"
						className="h-7"
						disabled={busy}
						onClick={dismiss}
					>
						Close
					</Button>
					<Button
						className="h-7"
						disabled={busy || completed}
						onClick={async () => {
							setBusy(true);
							try {
								const result = await pluginRequest({
									...pending,
									action: "complete",
								});
								if (result.kind !== "attempt" || result.state !== "connected")
									throw new Error();
								clearPluginConfirmation();
								setMessage("Connected. You can return to your chat.");
								setCompleted(true);
							} catch {
								setMessage(
									"This connection expired or belongs to another Zuse account. Return to Plugins and try again.",
								);
							} finally {
								setBusy(false);
							}
						}}
					>
						Confirm connection
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
