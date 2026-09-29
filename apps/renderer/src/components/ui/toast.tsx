"use client";

import { Toast } from "@base-ui/react/toast";
import { type ComponentProps, lazy, type ReactElement, Suspense } from "react";

// Keep managers and providers eager so notifications emitted during startup are
// retained while their visual surfaces load.
const Toasts = lazy(() =>
	import("./toast-surfaces.tsx").then((module) => ({ default: module.Toasts })),
);
const AnchoredToasts = lazy(() =>
	import("./toast-surfaces.tsx").then((module) => ({
		default: module.AnchoredToasts,
	})),
);

export const toastManager: ReturnType<typeof Toast.createToastManager> =
	Toast.createToastManager();

export const anchoredToastManager: ReturnType<typeof Toast.createToastManager> =
	Toast.createToastManager();

export type ToastPosition =
	| "top-left"
	| "top-center"
	| "top-right"
	| "bottom-left"
	| "bottom-center"
	| "bottom-right";

export interface ToastProviderProps extends Toast.Provider.Props {
	position?: ToastPosition;
	portalProps?: ComponentProps<typeof Toast.Portal>;
}

export function ToastProvider({
	children,
	position = "bottom-right",
	portalProps,
	...props
}: ToastProviderProps): ReactElement {
	return (
		<Toast.Provider toastManager={toastManager} {...props}>
			{children}
			<Suspense fallback={null}>
				<Toasts portalProps={portalProps} position={position} />
			</Suspense>
		</Toast.Provider>
	);
}

export interface AnchoredToastProviderProps extends Toast.Provider.Props {
	portalProps?: ComponentProps<typeof Toast.Portal>;
}

export function AnchoredToastProvider({
	children,
	portalProps,
	...props
}: AnchoredToastProviderProps): ReactElement {
	return (
		<Toast.Provider toastManager={anchoredToastManager} {...props}>
			{children}
			<Suspense fallback={null}>
				<AnchoredToasts portalProps={portalProps} />
			</Suspense>
		</Toast.Provider>
	);
}

export { Toast as ToastPrimitive };
