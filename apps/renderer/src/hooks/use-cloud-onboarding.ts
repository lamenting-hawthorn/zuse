import { useCallback, useEffect, useRef, useState } from "react";
import {
	CLOUD_ONBOARDING_RESUME,
	cloudOnboardingCompleted,
	cloudOnboardingRequired,
	completeCloudOnboarding,
} from "../lib/cloud-onboarding.ts";
import {
	hasCloudEntitlement,
	loadCloudEntitlements,
	loadCloudWorkspacePlacement,
} from "../lib/cloud-workspace-session-cache.ts";
import { subscribeControlPlaneSessionCache } from "../lib/control-plane-client.ts";

/** The app owns this gate, so checkout activation works from every surface. */
export function useCloudOnboarding(accountId: string | null, enabled: boolean) {
	const [owner, setOwner] = useState<string | null>(null);
	const open = enabled && accountId !== null && owner === accountId;
	const openRef = useRef(open);
	openRef.current = open;
	const deferred = useRef<string | null>(null);
	useEffect(() => {
		setOwner(null);
		deferred.current = null;
		if (!enabled || accountId === null) return;
		let disposed = false;
		let sequence = 0;
		const check = async (force = false) => {
			const request = ++sequence;
			try {
				const entitlements = await loadCloudEntitlements();
				if (disposed || request !== sequence) return;
				if (!hasCloudEntitlement(entitlements)) {
					setOwner(null);
					return;
				}
				if (openRef.current) return;
				if (
					!force &&
					(deferred.current === accountId ||
						cloudOnboardingCompleted(window.localStorage, accountId))
				)
					return;
				// Existing users with a built image should not be forced through setup again.
				const placement = await loadCloudWorkspacePlacement();
				if (disposed || request !== sequence) return;
				if (
					!force &&
					(placement.providers.length === 0 ||
						placement.images.length !== placement.providers.length)
				)
					return;
				if (
					force ||
					cloudOnboardingRequired({
						subscribed: placement.subscribed,
						completed: false,
						hasExistingImage: placement.images.some(
							(image) => image.generation !== undefined,
						),
					})
				) {
					setOwner(accountId);
				}
			} catch {
				/* A network failure must not replace the user's current screen. */
			}
		};
		const stop = subscribeControlPlaneSessionCache((key) => {
			if (key === "cloud-workspace:entitlements") void check();
		});
		const resume = () => void check(true);
		window.addEventListener(CLOUD_ONBOARDING_RESUME, resume);
		void check();
		return () => {
			disposed = true;
			stop();
			window.removeEventListener(CLOUD_ONBOARDING_RESUME, resume);
		};
	}, [accountId, enabled]);
	const finish = useCallback(() => {
		if (accountId === null) return;
		completeCloudOnboarding(window.localStorage, accountId);
		deferred.current = accountId;
		setOwner(null);
	}, [accountId]);
	const defer = useCallback(() => {
		deferred.current = accountId;
		setOwner(null);
	}, [accountId]);
	return { open, finish, defer };
}
