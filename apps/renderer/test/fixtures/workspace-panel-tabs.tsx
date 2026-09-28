import {
	ComputerTerminal01Icon,
	GitPullRequestIcon,
} from "@zuse/icons/solid-rounded";
import { createRoot } from "react-dom/client";
import { WorkspacePanelTab } from "../../src/components/workspace-panel-tab.tsx";
import "../../src/styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing fixture root");
root.className = "dark";
createRoot(root).render(
	<div className="workspace-panel-tabs flex items-center gap-0.5">
		{[false, true].map((active) => (
			<WorkspacePanelTab
				key={String(active)}
				active={active}
				icon={ComputerTerminal01Icon}
				label="zsh"
				closeLabel="Close zsh"
				onSelect={() => {}}
				onClose={() => {}}
				actions={
					<button
						type="button"
						aria-label="Terminal status"
						className="flex size-4 items-center justify-center"
					>
						<span className="size-1.5 rounded-full bg-emerald-400" />
					</button>
				}
			/>
		))}
		<WorkspacePanelTab
			active={false}
			icon={GitPullRequestIcon}
			label="PR"
			closeLabel="Close PR"
			onSelect={() => {}}
			onClose={() => {}}
		/>
	</div>,
);
