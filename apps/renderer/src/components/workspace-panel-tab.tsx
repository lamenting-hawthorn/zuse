import { HugeiconsIcon } from "@hugeicons/react";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { isInputComposing } from "../lib/input-composition.ts";

export function WorkspacePanelTab({
	active,
	icon,
	label,
	closeLabel,
	badge,
	actions,
	onSelect,
	onClose,
}: {
	active: boolean;
	icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
	label: string;
	closeLabel: string;
	badge?: ReactNode;
	actions?: ReactNode;
	onSelect: () => void;
	onClose: () => void;
}) {
	return (
		<div
			className={`workspace-panel-tab group flex shrink-0 items-center gap-1 rounded px-1.5 text-[11px] transition-colors ${
				active
					? "bg-muted text-foreground"
					: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
			}`}
		>
			<button
				type="button"
				onClick={onSelect}
				className="flex h-full max-w-36 items-center gap-1.5"
			>
				<HugeiconsIcon icon={icon} className="size-3.5 shrink-0 opacity-80" />
				<span className="truncate">{label}</span>
				{badge}
			</button>
			{actions}
			<button
				type="button"
				aria-label={closeLabel}
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				onKeyDown={(e) => {
					if (isInputComposing(e)) return;

					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						e.stopPropagation();
						onClose();
					}
				}}
				className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
			>
				<X className="size-3" strokeWidth={1.8} />
			</button>
		</div>
	);
}
