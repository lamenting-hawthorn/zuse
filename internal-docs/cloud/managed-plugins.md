# Managed plugins

Zuse embeds Executor v2 on Cloudflare, pinned to upstream commit
`50bea37fe5d146701990901a878ea940c5012564`. The renderer never receives vendor tokens,
client secrets, Executor settings, or user-editable server URLs.

This integration exposes catalog plugins, account connection, discovery and tool
calls. Schedules, workflows, codemode, webhooks, app UIs and user-authored code are
not exposed. The existing renderer and local/cloud agent contracts are unchanged.

## Deployment

Both API Wrangler configurations bind `PLUGIN_VAULT` to the SQLite-backed
`PluginVault` Durable Object, with the appended `plugins-v1` migration. Each
object owns one tenant. Its database is separate from workspace/runtime data.
`PLUGIN_APP_ORIGIN` is the hosted Zuse app that confirms OAuth connections;
`API_PUBLIC_ORIGIN` determines provider callback URLs. Keep these canonical
origins HTTPS and keep the app in `ALLOWED_BROWSER_ORIGINS`.

Install a **new, dedicated** random 32-byte base64url AES key as the API Worker's
`PLUGIN_ENCRYPTION_KEY` secret using Wrangler. Use separate keys for staging and
production, store recoverable copies in the deployment secret manager, and never
commit or print them. The service stays unavailable until the key and app origin
are configured. Deploy through the repository's usual guarded API workflow.
No D1 database or external Executor account is required.
The fixed catalog runs through a Zuse-owned v2 runtime adapter: no dynamic
Worker Loader, R2 build bucket or Postgres database is needed for plugins.

The Durable Object's internal schema marker is now `2`; `plugins-v1` remains the
Wrangler class-creation migration tag, not an Executor schema version. Existing
v1 objects fail closed before running v2 SQL migrations. This work has not been
deployed, so the intended first deployment uses fresh plugin objects. If an
earlier build was deployed independently, preserve that data and plan an explicit
conversion before deploying; never clear a namespace or initialize over it.

Do not replace this key on a running deployment without migrating stored
ciphertexts: doing so makes existing credentials and pending OAuth attempts
unreadable. Back up the key alongside the Durable Object data.

## Ownership and access

The API derives `personal:<accountId>` and, when present in a verified WorkOS
session, `organization:<orgId>`. Body fields cannot grant tenant membership.
Within either tenant, connections belong to the verified subject. Organization
sharing and administrator roles are deliberately not exposed: that requires an
organization membership/role service and organization-bound cloud workspaces.
The namespace and subject separation are already present for that extension.

Local and cloud agent sessions currently use personal connections. The cloud
endpoint reuses the workspace's current runtime credential and deletion fence;
local sessions bind to the account active when the agent handle is created.
Changing accounts invalidates that handle's plugin access. Start a new chat
session to use another account. The organization catalog API is available only
with a matching organization claim; organization connections are not currently
injected into personal cloud sessions.

Provider secrets are encrypted with v2's AES-GCM adapter in Durable Object SQLite.
HKDF derives a per-object credential key from the configured secret; authenticated
data binds each envelope to its SDK resource ID. Pending Zuse confirmation data
uses encrypted KV bound to its object and storage key. A per-tenant queue
serializes SDK operations, token refresh, disconnect, callbacks, and expiry
cleanup. SDK SQL transactions use the upstream Effect Durable Object SQLite driver;
remote mutations and Zuse metadata are not a distributed transaction. Metadata fences
prevent partially deleted/failed connections from being invoked. In-flight
external actions cannot be undone by disconnect.

## OAuth and catalog

`plugin-catalog.ts` is the only source of provider endpoints and outbound
origin allowlists. Initial integrations are Linear (DCR OAuth) and Cloudflare
Docs (public MCP). Provider references:

- [Linear MCP documentation](https://linear.app/docs/mcp)
- [Cloudflare remote MCP servers](https://github.com/cloudflare/mcp-server-cloudflare)

Adding a catalog entry requires verifying remote MCP transport, OAuth metadata,
DCR support, scopes, and every required HTTPS origin. Servers requiring a
pre-registered OAuth client are not automatically compatible. Providers may
impose their own plan or organization restrictions.

OAuth uses Zuse client branding and PKCE. Callback state maps to a server-stored
owner. The callback stores the authorization code encrypted and redirects an
opaque one-use confirmation ticket to the hosted app. The initiating Zuse user
must confirm before token exchange. Another account cannot finish a forwarded
link. Attempts expire after ten minutes; alarms cancel expired attempts and
purge terminal attempts after a day. Closing/reopening Plugins resumes pending
attempt polling from the server. There is no automatic tool-call retry at the
Zuse HTTP boundary.

The stable tenant MCP endpoint is
`/v1/plugins/<encoded-tenant-id>/mcp`; it requires a verified WorkOS bearer and
matching tenant membership. Zuse itself uses the authenticated tools routes
through its session gateway, so users do not copy URLs or tokens.

## Agents and UI

Settings → Integrations contains the searchable plugin catalog and connection
management. Existing workspace-specific Linear ticket integration remains in
its own disclosure. Account data is loaded through the control-plane RPC, not
through the currently selected workspace.

The shared session gateway exposes `plugins_search`, `plugins_schema`, and
`plugins_call`. Invocation follows Zuse's permission policy; plan mode blocks
calls conservatively. Provider elicitation and additional engine approval are
not automatically accepted. No v2 management or automation tools enter the agent
catalog.

Each connection owns an SDK app/profile and, when authenticated, an account.
The SDK owner derives from both the tenant and subject. Every tool operation
rechecks app/profile ownership; no browser-supplied SDK IDs select credentials.
Disconnect removes the app and saved account. Cleanup also reads the SDK's
completed connection state, so an interrupted Zuse metadata write cannot leave
the newly created account's credentials behind.

Claude, Codex, Gemini, Grok, and Kiro use the existing shared gateway. Cursor
receives an additional session MCP server; both OpenCode drivers receive remote
MCP configuration in their process environment. Pi receives a temporary native
tool extension with a revocable loopback credential, removed on teardown. No
upstream tokens are installed in any agent runtime.

## Verification

From `infra/api`:

```sh
bunx vitest run test/integration/plugin-vault.test.ts test/unit/plugin-routes.test.ts test/unit/plugin-mcp.test.ts
bun run check-types
bunx wrangler deploy --dry-run --outdir ../../.context/plugin-worker-build
```

Worker tests exercise real workerd, SQLite, encryption, and the embedded SDK
against deterministic upstream HTTP fixtures. They cover Worker restart,
subject/tenant isolation, discovery, calls, disconnect, OAuth PKCE and branded
DCR, confirmation ownership, replay rejection, cancellation, multiple connections,
token refresh, failed exchange cleanup, and account removal. Agent tests
cover permission denial/approval before invocation. These are not live provider
consent tests. After staging deployment, connect with a real account, confirm
in the hosted app, invoke from desktop and cloud, then disconnect and verify
access is gone before promoting production.

The renderer browser regression is `bun run test:plugins-browser` from
`apps/renderer`. It mounts the production components against a deterministic
control-plane fixture and verifies confirmation, search, connection details,
disconnect, and empty states. It does not require a live WorkOS account.

## Updating the v2 adapter

`packages/executor-v2` exposes a small Promise API. Its generated bundle includes
the private v2 SDK's pinned Effect snapshot; Zuse keeps Effect beta.102. The
checksummed upstream source archive and isolated Bun toolchain lockfile are
checked in. Runtime code never imports a research checkout or downloads source.

From `packages/executor-v2`, run `bun run build` after adapter changes, then
`bun run check-types`. The latter typechecks the adapter plus reachable upstream
source and independently rebuilds the bundle to detect stale generated output.
Both commands install the locked build dependencies in a temporary directory
outside the monorepo. Normal API builds consume the checked-in bundle directly.
Upstream's Effect and JSON-schema patches are retained in `toolchain/patches`.

The static runtime matches retained catalog source against bundled definitions;
build IDs hash that source. Changing a definition cannot silently execute the
new definition under an old build ID. Existing connections to a changed
definition need a deliberate migration or reconnection. Source retention uses
immutable, content-addressed KV snapshots because Zuse does not expose app
editing or source publication in this scope.
