import "@zuse/i18n/english/common";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMessages } from "@zuse/i18n/react";
import { Copy01Icon, Tick02Icon } from "@zuse/icons/solid-rounded";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { copyText } from "../lib/platform-capabilities.ts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip.tsx";

export function CopyButton({
	text,
	label,
	showLabel = false,
	className,
}: {
	readonly text: string;
	readonly label?: string;
	readonly className?: string;
	readonly showLabel?: boolean;
}) {
	const { message } = useMessages(["common"]);
	const [state, setState] = useState<"idle" | "copied" | "error">("idle");

	useEffect(() => {
		if (state === "idle") return;
		const id = window.setTimeout(() => setState("idle"), 1500);
		return () => window.clearTimeout(id);
	}, [state]);

	const onCopy = () => {
		void copyText(text).then(
			() => setState("copied"),
			() => setState("error"),
		);
	};

	const icon = state === "copied" ? Tick02Icon : Copy01Icon;
	const title =
		state === "copied"
			? message("common:copied")
			: state === "error"
				? message("common:copy_failed")
				: (label ?? message("common:copy"));

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						onClick={onCopy}
						aria-label={title}
						className={cn(
							"inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-muted-foreground/70 outline-none",
							showLabel ? "h-7 px-2 text-xs" : "size-6",
							"hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
							className,
						)}
					>
						<HugeiconsIcon
							icon={icon}
							className="size-3.5"
							aria-hidden="true"
						/>
						{showLabel ? title : null}
					</button>
				}
			/>
			<TooltipPopup>{title}</TooltipPopup>
		</Tooltip>
	);
}
