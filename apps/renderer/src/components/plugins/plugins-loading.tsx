import { LogoTraceLoader } from "../logo-trace-loader.tsx";

/** Loading state for plugin and skill lists: the traced Zuse mark. */
export function PluginsLoading({ label }: { readonly label: string }) {
	return (
		<div
			role="status"
			className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground"
		>
			<LogoTraceLoader
				ariaLabel={label}
				className="text-foreground/70"
				size={48}
			/>
			<p>{label}</p>
		</div>
	);
}
