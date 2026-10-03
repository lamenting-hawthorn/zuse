import { lazy, Suspense, useState } from "react";
import { hasPluginConfirmation } from "~/lib/plugin-confirmation-storage.ts";

const Confirmation = lazy(() =>
	import("./plugin-confirmation.tsx").then((module) => ({
		default: module.PluginConfirmation,
	})),
);
export function PluginConfirmationBoundary() {
	const [pending] = useState(hasPluginConfirmation);
	return pending ? (
		<Suspense fallback={null}>
			<Confirmation />
		</Suspense>
	) : null;
}
