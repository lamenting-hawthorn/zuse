import { useState } from "react";
import { pluginIconUrl } from "~/lib/connected-plugins.ts";
import { cn } from "~/lib/utils";

export function PluginIcon({
	name,
	domain,
	className,
}: {
	readonly name: string;
	readonly domain: string;
	readonly className?: string;
}) {
	const [failed, setFailed] = useState(false);
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-muted text-[13px] font-medium text-muted-foreground ring-1 ring-inset ring-foreground/5",
				className,
			)}
		>
			{failed || domain.length === 0 ? (
				name.slice(0, 1).toUpperCase()
			) : (
				<img
					src={pluginIconUrl(domain)}
					alt=""
					loading="lazy"
					decoding="async"
					referrerPolicy="no-referrer"
					className="size-full object-cover"
					onError={() => setFailed(true)}
				/>
			)}
		</span>
	);
}
