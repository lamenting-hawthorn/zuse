// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { executorActions } from "../../src/lib/executor-client.ts";

const state = vi.hoisted(() => ({ environment: "local" }));
vi.mock("../../src/lib/executor-client.ts", () => ({
	executorActions: { state: vi.fn(), execute: vi.fn() },
}));
vi.mock("../../src/store/environment-catalog.ts", () => ({
	useEnvironmentCatalogStore: (
		select: (value: { activeEnvironmentId: string }) => unknown,
	) => select({ activeEnvironmentId: state.environment }),
}));

import { AgentPluginsPane } from "../../src/components/settings/agent-plugins-pane.tsx";

it("offers the same shared plugin UI on local and cloud environments", () => {
	for (const environment of ["local", "cloud:workspace-1"]) {
		state.environment = environment;
		const html = renderToStaticMarkup(<AgentPluginsPane />);
		expect(html).toContain("Connect Executor");
		expect(html).toContain(environment);
		expect(html).toContain("h-7");
		expect(html).not.toContain("Codex plugins run inside Codex");
		expect(html).not.toContain("local desktop");
	}
});

const disconnected = {
	configured: false,
	url: null,
	enabled: false,
	toolkit: null,
	integrations: [],
	connections: [],
	toolkits: [],
	error: null,
};
it("submits a personal key once to the selected environment and clears it after connection", async () => {
	state.environment = "cloud-fixture";
	vi.mocked(executorActions.state).mockResolvedValue(disconnected);
	vi.mocked(executorActions.execute).mockResolvedValue({
		...disconnected,
		configured: true,
		url: "https://executor.example.com",
		enabled: true,
	});
	const node = document.createElement("div");
	document.body.append(node);
	const root = createRoot(node);
	try {
		await act(async () => root.render(<AgentPluginsPane />));
		const fill = async (selector: string, value: string) => {
			const input = node.querySelector<HTMLInputElement>(selector);
			if (!input) throw Error("Missing connection input");
			await act(async () => {
				Object.getOwnPropertyDescriptor(
					HTMLInputElement.prototype,
					"value",
				)?.set?.call(input, value);
				input.dispatchEvent(new Event("input", { bubbles: true }));
			});
		};
		await fill('input[type="url"]', "https://executor.example.com");
		await fill('input[type="password"]', "fixture-key");
		const connect = node.querySelector<HTMLButtonElement>(
			'button[type="submit"]',
		);
		expect(connect).not.toBeNull();
		expect(connect?.disabled).toBe(false);
		await act(async () => {
			connect?.click();
			connect?.click();
		});
		expect(executorActions.execute).toHaveBeenCalledExactlyOnceWith(
			"cloud-fixture",
			{
				_tag: "connect",
				url: "https://executor.example.com",
				token: "fixture-key",
			},
		);
		expect(node.querySelector('input[type="password"]')).toBeNull();
		expect(node.textContent).toContain("Manage tools and accounts");
	} finally {
		await act(async () => root.unmount());
		node.remove();
		vi.clearAllMocks();
	}
});
it("ignores an old environment response after switching environments", async () => {
	let finish: (value: import("@zuse/contracts").ExecutorState) => void =
		() => {};
	state.environment = "local";
	vi.mocked(executorActions.state).mockImplementation((env) =>
		env === "local"
			? new Promise((resolve) => {
					finish = resolve;
				})
			: Promise.resolve(disconnected),
	);
	const node = document.createElement("div");
	document.body.append(node);
	const root = createRoot(node);
	try {
		await act(async () => root.render(<AgentPluginsPane />));
		state.environment = "cloud-fixture";
		await act(async () => root.render(<AgentPluginsPane />));
		await act(async () =>
			finish({
				...disconnected,
				configured: true,
				url: "https://old-account.example.com",
			}),
		);
		expect(node.textContent).toContain("cloud-fixture");
		expect(node.textContent).not.toContain("old-account");
		expect(node.querySelector('input[type="password"]')).not.toBeNull();
	} finally {
		await act(async () => root.unmount());
		node.remove();
		vi.clearAllMocks();
	}
});
