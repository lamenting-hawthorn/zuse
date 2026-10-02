import "@zuse/i18n/english/settings";
import type { ChatSharingDefaults } from "@zuse/contracts";
import { useMessages } from "@zuse/i18n/react";
import { cn } from "~/lib/utils";
import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
	SelectValue,
} from "./ui/select.tsx";

/** Borderless trigger whose text lines up with surrounding labels. */
export const GHOST_TRIGGER =
	"h-7 w-auto min-w-0 border-0 bg-transparent px-2 shadow-none before:hidden hover:bg-accent dark:bg-transparent dark:hover:bg-accent";

/** The same access choices are used for a chat and for future-chat defaults. */
export function ChatSharingOptions({
	value,
	organizationName,
	disabled,
	onChange,
	className,
}: {
	readonly value: ChatSharingDefaults;
	readonly organizationName: string;
	readonly disabled: boolean;
	readonly onChange: (value: ChatSharingDefaults) => void;
	readonly className?: string;
}) {
	const { message } = useMessages(["settings"]);
	const audiences = [
		{ value: "private", label: message("settings:workspace_sharing_private") },
		{
			value: "organization",
			label: message("settings:workspace_sharing_everyone", {
				name: organizationName,
			}),
		},
	];
	const permissions = [
		{ value: "view", label: message("settings:workspace_sharing_view") },
		{ value: "edit", label: message("settings:workspace_sharing_edit") },
	];
	return (
		<div
			className={cn(
				"flex min-w-0 items-center justify-between gap-2",
				className,
			)}
		>
			<Select
				items={audiences}
				value={value.audience}
				disabled={disabled}
				onValueChange={(audience) => {
					if (audience === "private" || audience === "organization")
						onChange({ ...value, audience });
				}}
			>
				<SelectTrigger
					className={cn(GHOST_TRIGGER, "-ms-2 max-w-full")}
					aria-label={message("settings:workspace_sharing_audience")}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectPopup>
					{audiences.map((item) => (
						<SelectItem key={item.value} value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectPopup>
			</Select>
			<Select
				items={permissions}
				value={value.permission}
				disabled={disabled || value.audience === "private"}
				onValueChange={(permission) => {
					if (permission === "view" || permission === "edit")
						onChange({ ...value, permission });
				}}
			>
				<SelectTrigger
					className={cn(GHOST_TRIGGER, "-me-1.5")}
					aria-label={message("settings:workspace_sharing_permission")}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectPopup>
					{permissions.map((item) => (
						<SelectItem key={item.value} value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectPopup>
			</Select>
		</div>
	);
}
