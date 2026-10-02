import { App } from "./app.tsx";
import { ToastProvider } from "./components/ui/toast.tsx";
import { startWorkspaceNavigation } from "./lib/workspace-navigation.ts";
import { AppAtomProvider } from "./state/registry.tsx";

const stopWorkspaceNavigation = startWorkspaceNavigation();
if (import.meta.hot) import.meta.hot.dispose(stopWorkspaceNavigation);

export function Application({ onReady }: { readonly onReady?: () => void }) {
	return (
		<AppAtomProvider>
			<ToastProvider>
				<App onReady={onReady} />
			</ToastProvider>
		</AppAtomProvider>
	);
}
