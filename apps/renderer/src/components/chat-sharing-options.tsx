import "@zuse/i18n/english/settings";
import type { ChatSharingDefaults } from "@zuse/contracts";
import { useMessages } from "@zuse/i18n/react";
import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
	SelectValue,
} from "./ui/select.tsx";

/** The same access choices are used for a chat and for future-chat defaults. */
export function ChatSharingOptions({
	value,
	organizationName,
	disabled,
	onChange,
}: {
	readonly value: ChatSharingDefaults;
	readonly organizationName: string;
	readonly disabled: boolean;
	readonly onChange: (value: ChatSharingDefaults) => void;
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
		<div className="flex flex-wrap items-center gap-2">
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
					className="h-7 w-auto max-w-full"
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
					className="h-7 w-auto"
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
