import { AgentPluginsPane } from "./settings/agent-plugins-pane.tsx";
import "@zuse/i18n/english/extensions";
import { formatDate as formatUiDate } from "@zuse/i18n";
import { isHostedProduct } from "../lib/hosted-connect.ts";
import { refreshHostedProjects } from "../lib/hosted-workspace.ts";
import { isInputComposing } from "../lib/input-composition.ts";
import { WallpaperSettings } from "./settings/wallpaper-settings";
import "@zuse/i18n/english/settings";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	type AppearanceMode,
	type BranchNamingStyle,
	CommandId,
	type CompletionSoundPreset,
	type ComputerAwakeMode,
	type ComputerAwakeStatus,
	EnvironmentId,
	type ExtensionProviderDescriptor,
	type Folder,
	type FolderId,
	PROVIDER_IDS,
	type ProviderId,
	type RuntimeMode,
	visibleModelsForProvider,
} from "@zuse/contracts";
import { message as uiMessage } from "@zuse/i18n";
import { RichMessage, useMessages as useUiMessages } from "@zuse/i18n/react";
import {
	Alert01Icon,
	Delete02Icon,
	Folder01Icon,
	PencilEdit01Icon,
	Tick01Icon,
	VolumeHighIcon,
} from "@zuse/icons/solid-rounded";
import { ChevronLeft, Plus, RefreshCw as RefreshIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cloudWorkspaceBetaAvailable } from "~/lib/cloud-machines-availability.ts";
import { displayPath } from "~/lib/display-path";
import { hasHostCapability, isMacHost } from "~/lib/host-platform";
import { rendererPlatformCapabilities } from "~/lib/platform-capabilities.ts";
import { isInitialProviderAvailabilityLoading } from "~/lib/provider-status";
import { SETTINGS_NAVIGATION as VISIBLE_RAIL } from "~/lib/settings-navigation.ts";
import {
	formatRelativeTime,
	useRelativeTimeTick,
} from "~/lib/use-relative-time.ts";
import { cn } from "~/lib/utils";
import { useModelCatalogStore } from "~/store/model-catalog";
import { useAuth } from "../hooks/use-auth.ts";
import type { BrowserCookieImportStatus } from "../lib/bridge.ts";
import {
	COMPLETION_SOUND_PRESETS,
	playCompletionSound,
	prepareCompletionSound,
} from "../lib/completion-sounds.ts";
import {
	computerAwakeModeDescription,
	computerAwakeStatusText,
} from "../lib/computer-awake.ts";
import { dispatchEnvironmentShellCommand } from "../lib/environment-shell-client-bus.ts";
import { useExtensionCatalog } from "../lib/extension-client-bus.ts";
import { PROVIDER_LABEL } from "../lib/provider-labels.ts";
import { useSettingsStore } from "../lib/settings-client-bus.ts";
import { useEnvironmentCatalogStore } from "../store/environment-catalog.ts";
import { useProvidersStore } from "../store/providers.ts";
import { type SettingsSection, useUiStore } from "../store/ui.ts";
import { useWorkspaceStore } from "../store/workspace.ts";
import { BlurredEmail } from "./blurred-email.tsx";
import { BrowserProfileSelect } from "./browser-profile-select.tsx";
import { LanguageSelector } from "./language-selector.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { ProviderCard } from "./provider-card.tsx";
import { ProviderIcon } from "./provider-icons.tsx";
import { MODE_META, MODES_ORDER } from "./runtime-mode-meta.ts";
import { CloudWorkspacePool } from "./settings/cloud-workspace-pool.tsx";
import { DeveloperPane } from "./settings/developer-pane.tsx";
import { DevicesPane } from "./settings/devices-pane.tsx";
import { DiagnosticsPane as FullDiagnosticsPane } from "./settings/diagnostics-pane.tsx";
import { HostedDevicesPane } from "./settings/hosted-devices-pane.tsx";
import { ExtensionsPane } from "./settings/extensions-pane.tsx";
import { KeybindingsPane } from "./settings/keybindings-editor.tsx";
import { LinearIntegrationsPane } from "./settings/linear-integrations-pane.tsx";
import { McpServersPane } from "./settings/mcp-servers-pane.tsx";
import { PokedexPane } from "./settings/pokedex-pane.tsx";
import { UpdateChannelSettings } from "./settings/update-channel-settings.tsx";
import { RepositorySettings } from "./settings-repository.tsx";
import {
	AlertDialog,
	AlertDialogClose,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogPopup,
	AlertDialogTitle,
} from "./ui/alert-dialog.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar.tsx";
import { Button } from "./ui/button.tsx";
import { SegmentedTabs } from "./ui/segmented-tabs.tsx";
import {
	SettingsCard,
	SettingsGroup,
	SettingsRow,
	SettingsFrame as SharedSettingsFrame,
} from "./ui/settings-panel.tsx";

export { SettingsGroup, SettingsRow } from "./ui/settings-panel.tsx";

import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
	SelectValue,
} from "./ui/select.tsx";
import { Switch } from "./ui/switch";

const CLOUD_MACHINES_AVAILABLE = cloudWorkspaceBetaAvailable();
/**
 * Two-pane settings surface. The left rail navigates between global
 * sections (General / Models & Providers / Workspace) and per-repository
 * settings; the right pane renders the active section's form.
 */
export function SettingsPage() {
	const { message: uiMessage } = useUiMessages([
		"common",
		"settings",
		"extensions",
	]);

	const setView = useUiStore((s) => s.setView);
	const section = useUiStore((s) => s.settingsSection);
	const setSection = useUiStore((s) => s.setSettingsSection);
	const folders = useWorkspaceStore((s) => s.folders);
	const loadFolders = useWorkspaceStore((s) => s.load);
	const desktop = rendererPlatformCapabilities().desktop;
	const visibleSection: SettingsSection =
		!CLOUD_MACHINES_AVAILABLE && section.kind === "machines"
			? { kind: "general" }
			: section;

	useEffect(() => {
		if (!isHostedProduct() && folders.length === 0) void loadFolders();
	}, [folders.length, loadFolders]);

	useEffect(() => {
		if (!CLOUD_MACHINES_AVAILABLE && section.kind === "machines") {
			setSection({ kind: "general" });
		}
	}, [section.kind, setSection]);

	return (
		<div className="settings-surface flex min-h-0 flex-1 flex-col bg-background [&_button[data-slot=button]:not([class*='size-'])]:h-7 [&_button[data-slot=button]:not([class*='size-'])]:text-[11px]">
			<header className="flex h-9 shrink-0 items-center border-b border-border bg-background/90 px-3 text-xs text-muted-foreground backdrop-blur-md [-webkit-app-region:drag]">
				<div className="w-16 shrink-0" />
				<button
					type="button"
					onClick={() => {
						if (isHostedProduct())
							void refreshHostedProjects(true).catch(() => undefined);
						setView("chat");
					}}
					aria-label={uiMessage("settings:settings_page_back_to_app")}
					className="flex items-center gap-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground [-webkit-app-region:no-drag]"
				>
					<ChevronLeft className="size-3.5" />
					<span>{uiMessage("settings:settings_page_back_to_app")}</span>
				</button>
			</header>
			<div className="flex min-h-0 flex-1">
				<Rail
					section={visibleSection}
					onSelect={setSection}
					folders={folders}
					desktop={desktop}
				/>
				<div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth overscroll-contain px-6 py-6 max-[800px]:px-4 max-[800px]:py-4">
					<div
						className={cn(
							"mx-auto flex w-full flex-col gap-5",
							visibleSection.kind === "diagnostics" ||
								visibleSection.kind === "shortcuts"
								? "max-w-6xl"
								: visibleSection.kind === "pokedex"
									? "max-w-5xl"
									: "max-w-3xl",
						)}
					>
						<SectionTitle section={visibleSection} folders={folders} />
						<Pane section={visibleSection} />
					</div>
				</div>
			</div>
		</div>
	);
}

function Rail({
	section,
	onSelect,
	folders,
	desktop,
}: {
	section: SettingsSection;
	onSelect: (section: SettingsSection) => void;
	folders: ReadonlyArray<Folder>;
	desktop: boolean;
}) {
	useUiMessages(["common", "settings", "extensions"]);

	return (
		<nav className="flex w-52 shrink-0 flex-col gap-4 border-r border-sidebar-border bg-sidebar px-2.5 py-3 text-xs text-sidebar-foreground max-[800px]:w-12 max-[800px]:px-1.5">
			<div className="flex flex-col gap-0.5">
				{VISIBLE_RAIL.filter((item) =>
					isHostedProduct()
						? [
								"general",
								"providers",
								"defaults",
								"machines",
								"devices",
								"shortcuts",
							].includes(item.section.kind)
						: desktop || item.section.kind !== "machines",
				).map((item) => {
					const active =
						section.kind !== "repository" && section.kind === item.section.kind;
					return (
						<RailButton
							key={item.id}
							active={active}
							onClick={() => onSelect(item.section)}
							icon={item.Icon}
							label={item.label}
						/>
					);
				})}
			</div>
			{!isHostedProduct() && folders.length > 0 && (
				<div className="flex flex-col gap-2 max-[800px]:hidden">
					<div className="flex items-center justify-between px-2">
						<RichMessage
							id="settings:settings_page_repositories_sentence"
							values={{ value: folders.length }}
							components={{
								part0: (
									<span className="text-[11px] font-medium tracking-wide text-muted-foreground/80" />
								),
								part1: (
									<span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" />
								),
							}}
						/>
					</div>
					<div className="flex flex-col gap-0.5">
						{folders.map((f) => {
							const active =
								section.kind === "repository" && section.projectId === f.id;
							return (
								<RailButton
									key={f.id}
									active={active}
									onClick={() =>
										onSelect({ kind: "repository", projectId: f.id })
									}
									icon={Folder01Icon}
									label={f.name}
									title={displayPath(f.path)}
									truncate
								/>
							);
						})}
					</div>
				</div>
			)}
		</nav>
	);
}

function RailButton({
	active,
	onClick,
	icon: Icon,
	label,
	title,
	truncate,
}: {
	active: boolean;
	onClick: () => void;
	icon: IconSvgElement;
	label: string;
	title?: string;
	truncate?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			className={cn(
				"flex min-h-7 items-center gap-2 rounded-md px-2.5 py-1 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[800px]:justify-center max-[800px]:px-1.5",
				active
					? "bg-sidebar-accent text-sidebar-accent-foreground"
					: "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
			)}
		>
			<HugeiconsIcon icon={Icon} className="size-4 shrink-0" />
			<span className={cn("max-[800px]:sr-only", truncate && "truncate")}>
				{label}
			</span>
		</button>
	);
}

function SectionTitle({
	section,
	folders,
}: {
	section: SettingsSection;
	folders: ReadonlyArray<Folder>;
}) {
	const { message: uiMessage } = useUiMessages([
		"common",
		"settings",
		"extensions",
	]);

	const { title, subtitle } = useMemo(() => {
		if (section.kind === "general") {
			return {
				title: uiMessage("settings:settings_page_general"),
				subtitle: "Defaults for new chats.",
			};
		}
		if (section.kind === "providers") {
			return {
				title: uiMessage("settings:settings_page_providers"),
				subtitle:
					"Verify what's installed, signed in, and which subscription each provider runs on.",
			};
		}
		if (section.kind === "agent-plugins") {
			return {
				title: uiMessage("extensions:plugins_title"),
				subtitle: uiMessage("extensions:plugins_subtitle"),
			};
		}
		if (section.kind === "extensions") {
			return {
				title: uiMessage("extensions:title"),
				subtitle:
					"Install and manage trusted local, Git, and curated extensions.",
			};
		}
		if (section.kind === "defaults") {
			return {
				title: uiMessage("settings:settings_page_default_models"),
				subtitle: "Choose how new chats start.",
			};
		}
		if (section.kind === "integrations") {
			return {
				title: uiMessage("settings:settings_page_integrations"),
				subtitle:
					"Connect issue workspaces and bring tickets into new sessions.",
			};
		}
		if (section.kind === "mcp") {
			return {
				title: uiMessage("settings:settings_page_mcp_servers"),
				subtitle:
					"Configured servers and provider-managed connectors, with live availability and authentication.",
			};
		}
		if (section.kind === "devices") {
			return {
				title: uiMessage("settings:settings_page_remote_access"),
				subtitle: isHostedProduct()
					? uiMessage("settings:hosted_remote_description")
					: "Use this computer from your phone, a browser, or another computer.",
			};
		}
		if (section.kind === "machines") {
			return {
				title: uiMessage("settings:settings_page_cloud_workspaces_beta"),
				subtitle:
					"Connect GitHub and your coding agents, then keep work running when this app is closed.",
			};
		}
		if (section.kind === "browser") {
			return {
				title: uiMessage("settings:settings_page_browser"),
				subtitle: "Sessions, password filling, privacy, and agent access.",
			};
		}
		if (section.kind === "pokedex") {
			return {
				title: uiMessage("settings:settings_page_pokedex"),
				subtitle: "Unlocked Pokémon from all worktrees.",
			};
		}
		if (section.kind === "diagnostics") {
			return {
				title: uiMessage("settings:settings_page_diagnostics"),
				subtitle:
					"Inspect failures, traces, processes, resources, and local support bundles.",
			};
		}
		if (section.kind === "shortcuts") {
			return {
				title: uiMessage("settings:settings_page_keyboard_shortcuts"),
				subtitle: "These also appear under the menu bar.",
			};
		}
		if (section.kind === "developer") {
			return {
				title: uiMessage("settings:settings_page_developer"),
				subtitle:
					"Accent palette + workflow chip/button states (dev builds only).",
			};
		}
		const f = folders.find((x) => x.id === section.projectId);
		return {
			title: f?.name ?? "Repository",
			subtitle: f?.path !== undefined ? displayPath(f.path) : "",
		};
	}, [section, folders, uiMessage]);
	return (
		<div className="flex min-w-0 flex-col gap-1 border-b border-border pb-4">
			<h1 className="truncate text-xl font-medium tracking-[-0.01em] text-foreground">
				{title}
			</h1>
			{subtitle && (
				<p className="max-w-2xl text-xs leading-5 text-muted-foreground">
					{subtitle}
				</p>
			)}
		</div>
	);
}

function Pane({ section }: { section: SettingsSection }) {
	if (section.kind === "general") return <GeneralPane />;
	if (section.kind === "defaults") return <DefaultModelsPane />;
	if (section.kind === "providers")
		return isHostedProduct() ? <CloudWorkspacePool /> : <ProvidersPane />;
	if (section.kind === "agent-plugins") return <AgentPluginsPane />;
