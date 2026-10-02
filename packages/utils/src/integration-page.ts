import { escapeHtml } from "./browser-page.ts";

// Static ordered-dither waves inspired by reactbits.dev/backgrounds/dither.
// Render once on the server: no scripts, GPU context, or third-party requests
// on a page whose URL contains authorization credentials.
const DITHER = (() => {
	const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
	let pixels = "";
	for (let y = 0; y < 64; y++) {
		for (let x = 0; x < 96; x++) {
			const wave =
				Math.sin(x / 19 + Math.sin(y / 17)) * 0.22 +
				Math.cos(y / 13 - x / 28) * 0.18 +
				0.32;
			if (wave > ((bayer[(y % 4) * 4 + (x % 4)] ?? 0) + 0.5) / 16)
				pixels += `M${x * 3} ${y * 3}h2v2h-2z`;
		}
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 288 192" preserveAspectRatio="xMidYMid slice" focusable="false"><path fill="currentColor" d="${pixels}"/></svg>`;
})();

const STYLES = `
:root{color-scheme:light dark;--bg:#f5f6f3;--panel:#fff;--fg:#202621;--muted:#697169;--line:#e9ece6;--soft:#f3f5f0;--font:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
@media(prefers-color-scheme:dark){:root{--bg:#101210;--panel:#191c19;--fg:#edf0e9;--muted:#a1a89d;--line:#2b3029;--soft:#242923}}
*{box-sizing:border-box}
body{margin:0;min-height:100svh;display:grid;place-items:center;padding:40px 20px;background:var(--bg);color:var(--fg);font:13px/1.5 var(--font);-webkit-font-smoothing:antialiased}
.stage{width:100%;max-width:440px;position:relative;padding:28px;background:var(--panel);border-radius:16px;box-shadow:0 8px 40px #00000008}
.dither{position:fixed;inset:0;pointer-events:none;overflow:hidden;color:#82956b;opacity:.16;mask-image:linear-gradient(140deg,#000,transparent 85%)}
.dither svg{width:100%;height:100%;display:block}
.eyebrow{display:flex;align-items:center;gap:10px;margin:0 0 24px;font-size:11px;color:var(--muted)}
.eyebrow strong{color:var(--fg);letter-spacing:.15em}
h1{font-size:24px;line-height:1.25;letter-spacing:-.035em;font-weight:600;margin:0 0 8px;text-wrap:balance}
.description{margin:0 0 24px;color:var(--muted);overflow-wrap:anywhere}
.actions{display:grid;gap:0}
.account{padding:16px 0;border-top:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center}
.account-name{display:block;font-size:13px;font-weight:600;overflow-wrap:anywhere}
.account-description{margin:2px 0 6px;color:var(--muted);font-size:12px;overflow-wrap:anywhere}
form{margin:0}
.action{position:relative;display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;border:0;border-radius:6px;background:var(--fg);color:var(--panel);font:500 12px var(--font);text-decoration:none;cursor:pointer;white-space:nowrap}
.action:hover{filter:brightness(.93)}
.action:active{transform:translateY(1px)}
.link{position:relative;display:inline-flex;align-items:center;gap:4px;min-height:28px;color:var(--muted);font-size:12px;text-decoration:underline;text-underline-offset:4px;text-decoration-color:var(--line)}
.link:hover{color:var(--fg);text-decoration-color:currentColor}
.standalone{justify-self:start;margin-top:8px}
.hint{margin:20px 0 0;color:var(--muted);font-size:12px}
:is(a,button):focus-visible{outline:2px solid var(--fg);outline-offset:4px}
@media(max-width:440px){body{padding:24px 16px}.stage{padding:24px 20px}.account{gap:12px}}
@media(max-width:340px){.account{grid-template-columns:1fr}.account form{justify-self:start}}
@media(pointer:coarse){:is(a,button)::before{content:"";position:absolute;inset:-8px 0}.account{gap:20px}.standalone{margin-top:24px}}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`;

export interface IntegrationPageInput {
	readonly integration: string;
	readonly title?: string;
	readonly description: string;
	readonly status: string;
	readonly hint: string;
	readonly actions: readonly (
		| { readonly label: string; readonly href: string }
		| {
				readonly label: string;
				readonly action: string;
				readonly csrf: string;
				readonly accountName?: string;
				readonly description?: string;
				readonly manageUrl?: string;
		  }
	)[];
}

export const renderIntegrationPage = (input: IntegrationPageInput): string => {
	const actions = input.actions
		.map((action) => {
			if ("href" in action)
				return `<a class="${input.actions.length === 1 ? "action" : "link"} standalone" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`;
			return `<section class="account"><div><span class="account-name">${escapeHtml(action.accountName ?? action.label)}</span>${action.description ? `<p class="account-description">${escapeHtml(action.description)}</p>` : ""}${action.manageUrl ? `<a class="link" href="${escapeHtml(action.manageUrl)}" target="_blank" rel="noopener noreferrer">Manage repository access<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false"><path d="M7 17 17 7M7 7h10v10"/></svg><span class="sr-only"> (opens in a new tab)</span></a>` : ""}</div><form method="post" action="${escapeHtml(action.action)}"><input type="hidden" name="csrf" value="${escapeHtml(action.csrf)}"><button class="action" type="submit" aria-label="${escapeHtml(`${action.label}${action.accountName ? `: ${action.accountName}` : ""}`)}">${escapeHtml(action.label)}</button></form></section>`;
		})
		.join("");
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.integration)} ${escapeHtml(input.status.toLowerCase())} · Zuse</title><style>${STYLES}</style></head><body><div class="dither" aria-hidden="true">${DITHER}</div><main class="stage"><p class="eyebrow"><strong>ZUSE</strong><span aria-hidden="true">/</span>${escapeHtml(input.integration)}</p><h1>${escapeHtml(input.title ?? `${input.integration} connected`)}</h1><p class="description">${escapeHtml(input.description)}</p><div class="actions">${actions}</div><p class="hint">${escapeHtml(input.hint)}</p></main></body></html>`;
};
