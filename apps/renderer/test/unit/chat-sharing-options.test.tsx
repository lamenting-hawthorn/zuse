import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { ChatSharingOptions } from "../../src/components/chat-sharing-options.tsx";

it.each([
	{ audience: "organization" as const, disabled: false, disabledControls: 0 },
	{ audience: "private" as const, disabled: false, disabledControls: 1 },
	{ audience: "organization" as const, disabled: true, disabledControls: 2 },
])("renders compact, labeled access controls: %j", ({
	audience,
	disabled,
	disabledControls,
}) => {
	const markup = renderToStaticMarkup(
		<ChatSharingOptions
			value={{ audience, permission: "edit" }}
			organizationName="Acme"
			disabled={disabled}
			onChange={() => {}}
		/>,
	);
	const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
	expect(buttons).toHaveLength(2);
	expect(buttons.every((button) => button.includes("h-7"))).toBe(true);
	expect(buttons.filter((button) => /\sdisabled=""/.test(button))).toHaveLength(
		disabledControls,
	);
	expect(markup).toContain('aria-label="Who has access"');
	expect(markup).toContain('aria-label="Organization permission"');
	expect(markup).toContain(
		audience === "private" ? "Private" : "Everyone in Acme",
	);
});
