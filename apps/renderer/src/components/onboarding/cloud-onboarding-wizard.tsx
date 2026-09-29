import "@zuse/i18n/english/settings";
import { useMessages } from "@zuse/i18n/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
	type CloudSetupProgress,
	type CloudSetupStep,
	firstIncompleteCloudStep,
} from "../../lib/cloud-onboarding.ts";
import { CloudWorkspacePool } from "../settings/cloud-workspace-pool.tsx";
import { Button } from "../ui/button.tsx";
import { StepHeader } from "./steps/shared.tsx";

const STEPS: readonly CloudSetupStep[] = ["github", "auth", "image"];

/** App-wide Cloud setup, using the same controls as ongoing cloud management. */
export function CloudOnboardingWizard({
	onFinish,
	onDefer,
}: {
	readonly onFinish: () => void;
	readonly onDefer: () => void;
}) {
	const { message } = useMessages(["common", "settings"]);
	const [step, setStep] = useState<CloudSetupStep>("github");
	const [progress, setProgress] = useState<CloudSetupProgress>({
		github: false,
		auth: false,
		image: false,
	});
	const initialized = useRef(false);
	const onProgress = useCallback(
		(next: CloudSetupProgress, loaded: boolean) => {
			setProgress(next);
			if (loaded && !initialized.current) {
				initialized.current = true;
				setStep(firstIncompleteCloudStep(next));
			}
		},
		[],
	);
	const index = STEPS.indexOf(step);
	const titles = {
		github: message("settings:cloud_setup_github"),
		auth: message("settings:cloud_setup_agent"),
		image: message("settings:cloud_setup_image"),
	};
	const descriptions = {
		github: message("settings:cloud_setup_github_description"),
		auth: message("settings:cloud_setup_agent_description"),
		image: message("settings:cloud_setup_image_description"),
	};
	const complete = progress.github && progress.auth && progress.image;
	return (
		<div className="relative z-50 flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
			<div className="h-8 shrink-0 [-webkit-app-region:drag]" />
			<div className="flex min-h-0 flex-1 overflow-y-auto px-5 pb-8">
				<div className="m-auto flex w-full max-w-xl shrink-0 flex-col gap-5">
					<div className="flex items-center justify-between gap-3">
						<p className="text-xs text-muted-foreground">
							{message("settings:cloud_setup_title")}
						</p>
						<Button className="h-7" size="xs" variant="ghost" onClick={onDefer}>
							{message("settings:cloud_setup_later")}
						</Button>
					</div>
					<ol
						className="flex items-center gap-2"
						aria-label={message("settings:cloud_setup_title")}
					>
						{STEPS.map((item, position) => (
							<li
								key={item}
								aria-current={item === step ? "step" : undefined}
								className={`h-1 flex-1 rounded-full ${position <= index ? "bg-foreground" : "bg-foreground/15"}`}
							>
								<span className="sr-only">{titles[item]}</span>
							</li>
						))}
					</ol>
					<StepHeader title={titles[step]} subtitle={descriptions[step]} />
					<div className="min-h-[20rem] space-y-3">
						<CloudWorkspacePool onboarding={{ step, onProgress }} />
					</div>
					<div className="flex items-center justify-between gap-3">
						<Button
							className="h-7"
							size="sm"
							variant="ghost"
							disabled={index === 0}
							onClick={() => setStep(STEPS[index - 1] ?? "github")}
						>
							<ChevronLeft />
							{message("common:back")}
						</Button>
						<Button
							className="h-7"
							size="sm"
							disabled={step === "image" ? !complete : !progress[step]}
							onClick={() => {
								if (step === "image") {
									if (complete) onFinish();
								} else setStep(STEPS[index + 1] ?? "image");
							}}
						>
							{step === "image"
								? message("settings:cloud_setup_finish")
								: message("common:continue")}
							<ChevronRight />
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
