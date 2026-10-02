import "@zuse/i18n/english/common";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMessages as useUiMessages } from "@zuse/i18n/react";
import { Loading03Icon } from "@zuse/icons/solid-rounded";
import type React from "react";
import { cn } from "~/lib/utils";

export function Spinner({
	className,
	...props
}: Omit<
	React.ComponentProps<typeof HugeiconsIcon>,
	"icon"
>): React.ReactElement {
	const { message: uiMessage } = useUiMessages(["common"]);

	return (
		<HugeiconsIcon
			icon={Loading03Icon}
			aria-label={uiMessage("common:loading")}
			className={cn("animate-spin motion-reduce:animate-none", className)}
			role="status"
			{...props}
		/>
	);
}
