# Zuse managed plugin marketplace

Companions: [test plan](test-plan.md) · [review findings and decisions](review.md).

Status: implementation proposal, 2026-09-29. This turn plans the marketplace and rebases the existing stack; it does not deploy a service or implement the marketplace. User-confirmed premise: Zuse owns discovery, installation, account connection, and access across local/cloud agents; users should not create Executor accounts or copy Executor endpoints/keys.

## Product contract

A user opens Settings → Plugins, finds a useful plugin, selects Add, connects an account in a browser or enters a service credential, reviews access, and uses it from supported coding agents. Their accounts and installed plugins follow their Zuse identity. Local/cloud runtimes obtain scoped access automatically through existing Zuse authentication. Ordinary offline/local coding remains available without signing in; managed plugins require Zuse sign-in and network access.

Tool requests/results pass through the Zuse-managed plugin service and the selected agent/model under the normal conversation flow. Connection consent and the data-handling guide must explain this; keeping credentials out of a model does not mean tool results stay on the device.

Executor is an internal execution/integration dependency. The Zuse marketplace is its own catalog, installation model, connection UX, authorization and publisher workflow. Do not rebrand the current list of already-connected Executor integrations as a marketplace. Keep the current URL/key connection under Advanced → Bring your own Executor, mutually exclusive with managed mode per runtime. Do not silently import personal Executor accounts or reuse the supplied personal organization for other customers.

### Terms and boundaries

| Concept | Purpose | Example |
|---|---|---|
| Plugin | Versioned agent tool package in the Zuse catalog; initially declarative remote MCP/OpenAPI/GraphQL definitions | GitHub Review, Linear Tasks |
| Connection | One user's authenticated service account, reusable by compatible plugin requirements | Work GitHub, Personal GitHub |
| Installation | A user's selected plugin version, configuration and enabled state | GitHub Review v1 installed |
| Grant | Permission for a particular runtime/session to use a subset of installations/actions | This project binds Work GitHub and permits selected repository reads |
| Extension | Existing trusted desktop UI/customization code, managed independently | Theme, board, usage panel |
| Coding agent adapter | Adds an agent runtime through ACP or a direct provider implementation | A new coding CLI in the model picker |
| Existing Integrations settings | Zuse app features such as repository/cloud provisioning; not automatically agent-tool consent | GitHub App repository access |

A plugin install does not imply account access. A connection does not enable every plugin. An installed plugin does not authorize every environment. This release does not promise native Codex/Claude hooks, arbitrary skills, executable scripts, or VS Code compatibility. Those need their own portable package contract. A declarative plugin can expose real API-backed tools to all compatible MCP agents now.

### Useful launch packages and release bar

| Package | Complete workflow | Connection | Actions / proof |
|---|---|---|---|
| GitHub Review | Read a PR, inspect checks/diff, ask Claude or Codex to fix it, then publish a selected review comment | GitHub App where existing permissions suffice, otherwise an explicit additional authorization | Read selected repositories; comment is separately approved; never widen cloud-build permissions silently |
| Linear Tasks | Read an assigned issue, implement it locally or in cloud, then post a progress update | Linear OAuth under a Zuse-owned OAuth app | Read issues; update/comment requires approval |
| Customer.io | Inspect a selected customer's permitted attributes and campaign configuration, then prepare a targeted change | Verified Customer.io API-key flow with region/product-specific fields | Scope to documented supported APIs; preview before any write; sending campaigns is not enabled by default |

These are acceptance targets, not assertions that upstream publishes ready-to-use packages. Phase 0 verifies API coverage and auth for each. A failing connector is labelled unavailable with a reason, never marketed as supported. Test with real nonproduction accounts and actual Claude Code + Codex calls. Every installed package must work alone. One connection may serve multiple compatible packages without granting extra OAuth scopes silently.

## What exists, and what is missing

| Existing code | Reuse / required change |
|---|---|
| `apps/server/src/executor/{client,service,handlers,gateway}.ts` | Keep advanced BYO mode and bounded transports. Refactor connection resolution behind one managed/BYO service; replace the process-wide agent capability with per-session grants for managed mode. Never proxy arbitrary account-wide Executor administration to agents. |
| `packages/agents/src/user-mcp/shared.ts`, provider drivers, `apps/server/src/provider/layers/provider-service.ts` | Reuse one shared MCP injection seam and HTTP/stdio fallback. Add typed availability/version negotiation and session-scoped binding. Do not reimplement login in each driver. |
| `apps/renderer/src/components/settings/agent-plugins-pane.tsx` and `executor-client.ts` | Replace primary URL/key form with marketplace/installed/account views; retain native settings spacing and environment routing. |
| `infra/api/src/{auth,workos,crypto,store,account-deletion}.ts` | Reuse WorkOS account authentication, registered environments, proof-bound tokens, revocation, account deletion. Add a distinct plugin audience/scope; never reuse a workspace-connect grant as a plugin credential. |
| `infra/api/src/{cloud-auth-authority,cloud-workspace-runtime-fence,cloud-github-app}.ts` | Reuse ownership/generation fencing and GitHub installation metadata/token broker where applicable. Service-account credentials remain separate from coding-agent login credentials. |
| `infra/api/drizzle/{schema.ts,migrations/}`, existing store/outbox patterns | Add account-scoped control-plane records and durable reconciliation. No new generic job platform. |
| `packages/extension-host` artifact/catalog validation and `.github/workflows/extensions-*` | Reuse audited digest/signature/archive primitives where applicable, not the unsandboxed desktop extension runtime. Extract a focused shared primitive only when both callers need it. |
| `DESIGN.md`, shared Button/Dialog/Select, existing environment catalog | Keep h-7 controls, subtle tonal surfaces, keyboard behavior and existing local/cloud selector. |

The current PR verifies BYO service access and agent forwarding. It does not provide Zuse-managed tenants, OAuth onboarding, a public plugin catalog, publishing, or account-wide connection sharing through Zuse identity.

## Executor feasibility and architecture decision

Research baseline: upstream commit `a6a7bf2090ce103e37e38858f91fdd6fbce4afb0`, already used by this stack. Its README documents the SDK; `packages/core/api/src/server/scoped-executor.ts` binds `Tenant` and `Subject`; `apps/host-selfhost/src/app.ts` composes identity/account/database/MCP providers. The stock self-host seed creates one organization. The hosted application's organization creation uses its own signed-in session and WorkOS configuration. These are evidence for an embeddable host, not a supported hosted reseller/provisioning API.

Primary references: [Executor repository](https://github.com/UsefulSoftwareCo/executor), [pinned host composition](https://github.com/UsefulSoftwareCo/executor/blob/a6a7bf2090ce103e37e38858f91fdd6fbce4afb0/apps/host-selfhost/src/app.ts), [pinned tenant binding](https://github.com/UsefulSoftwareCo/executor/blob/a6a7bf2090ce103e37e38858f91fdd6fbce4afb0/packages/core/api/src/server/scoped-executor.ts). Current v2 beta documentation describes a different account/app model; do not mix its API shapes into the pinned integration. Phase 0 must select and lock a supported revision before production work.

| Approach | Effort / risk | Outcome |
|---|---|---|
| Keep BYO URL/key and link to Executor's UI | Small / low implementation risk | Already useful advanced mode; does not meet the requested product |
| Provision through Executor's hosted product | Medium if a supported partner API exists / currently unverified | Requires an actual supported contract for identity, tenancy, branding, quotas and deletion; not selected based on undocumented endpoints |
| Zuse service embedding pinned Executor behind Zuse auth | Large / explicit operational responsibility | Recommended. Own marketplace and tenant mapping; reuse execution, connectors and policy machinery through a narrow adapter |

Recommended deployment: existing Cloudflare Zuse API is the control plane; one separately deployed `infra/plugin-service` is the execution/account-connection service, built as an immutable Linux container. Do not place the upstream self-host UI/sign-in in front of Zuse users. Use upstream SDK/host provider seams behind an internal authenticated API; keep dependency/version differences out of the renderer and API worker. Phase 0 proves a production database adapter, host auth injection, policy enforcement, durable approvals, key rotation, and shutdown/restart behavior. Failure is a release blocker, not permission to use one shared organization or an in-memory credential store.

Use a dedicated database/schema and credential encryption boundary for the service. Prefer the existing managed Postgres infrastructure with a proven upstream-compatible adapter; its existence in upstream test fixtures is not production validation. If it cannot pass phase 0, revise the persistence decision before implementation. Keep schema migration ownership separate from Zuse's control-plane tables.

## System and identity

```text
Zuse desktop UI / future web management
    | existing Zuse sign-in, account-scoped HTTP
    v
Zuse API (infra/api)
    | catalog + installs + grants + durable provisioning/deletion outbox
    | authenticated internal call, verified tenant/subject/context
    v
Zuse plugin service (pinned Executor host)
    | tenant-partitioned catalog / accounts / approvals / encrypted secrets
    v
GitHub / Linear / Customer.io / approved remote MCP services

local or cloud agent
    -> per-session runtime proxy (apps/server)
    -> Zuse plugin endpoint (proof-bound, short-lived runtime grant)
    -> current grant/install/account policy check
    -> Executor per-tool dispatch and approval checks
    -> provider
```

Use one service endpoint under a Zuse-owned origin, e.g. `https://api.zuse.sh/v1/plugins/mcp`. This is a proposed route, not a provisioned deployment. It may proxy to the isolated service or supply a signed service connection descriptor. Unique URLs per user are not necessary. Derive identity from verified credentials, never from a URL slug or caller-supplied account ID.

Initial tenant = one personal Zuse account, mapped server-side to a random stable service tenant ID. Subject = the verified account user. Schema reserves an explicit owner kind for future team tenants, but team creation/sharing/invitations are not smuggled into this release; current API authorization is personal-account based. No relationship to a third-party organization is inferred from an email/domain.

On first managed install, `ensurePluginTenant` transactionally records desired state and enqueues an idempotent provision operation. Provision by stable tenant ID; a reconciler completes or retries after crashes, then activates the mapping. Concurrent requests produce one tenant. Browsing does not allocate anything. Failure gives a retryable setup state and never blocks ordinary chat creation.

The current runtime proxy has one capability for its whole lifetime. Managed mode must instead bind each session to account + environment + runtime generation + project + session ID + allowed installation IDs + policy revision. Bind the cloud runtime grant to its enrollment key and current generation; bind local enrollment to the signed-in owner. Refresh short-lived grants automatically (proposed TTL 5 minutes), using registered-runtime proof and live ownership checks. Grants never carry provider refresh tokens. A compromised runtime may exercise its granted tools until revoked; process tokens are capabilities, not a sandbox for trusted local code.

Check revocation and current policy before each actual tool dispatch, including subcalls inside Executor code execution and approval resume. A cached outer MCP session must not bypass checks. Keep per-session MCP IDs scoped to principal and grant; no cross-tenant connection or response caches. Prefer a small authentication check over stale authorization. Old-runtime capability versions stay unavailable for managed plugins, with an actionable update message; never fall back to the wide BYO key.

Maintain one tested agent/version capability matrix (MCP transport, approvals, reconnect, tool refresh, errors) using the provider registry. Probe available versions where supported and show Supported / Update required / Unverified before enabling or trying a plugin. Transport support alone is not proof of end-to-end compatibility.

### Management authority, runtime authority and project identity

| API/action | Credential and authority | Execution-runtime restriction |
|---|---|---|
| Public catalog read | Anonymous read or signed-in client | No tenant data in public response |
| Provision, install/update/remove, connect/disconnect, choose bindings, widen access | Interactive Zuse account session with management audience; revalidate owner and expected revision | Runtime enrollment/execution grants cannot perform these actions |
| Approve/deny a pending write | Interactive authenticated client with approval scope, exact owner/approval/argument binding | The requesting runtime/agent cannot approve itself |
| Register local project or associate local/cloud projects | Interactive owner authorizes registration on an enrolled environment; runtime supplies opaque local project identity | No authority from a filesystem path, Git remote URL or claimed account ID |
| Obtain/refresh a session execution grant | Enrolled runtime proof, active generation, existing user-approved enablement | Only equal-or-narrower actions/resources/accounts; cannot create or widen consent |
| Execute tools / resume an approved execution | Session execution grant and live server-side policy/approval check | No management APIs, OAuth setup, credential reads or self-approval |
| Internal API→service request | Distinct audience, short TTL, authenticated service identity with bound tenant/subject/action | No unsigned tenant headers; user/runtime grants cannot impersonate this role |

Extend existing authentication primitives with distinct client kinds/audiences/scopes; possession of a generic DPoP key or environment credential is not management consent. Management UI talks to the account API through the existing authenticated client; do not send its bearer/refresh credentials through the agent execution channel. Trusted code running as the same OS user is outside a hard sandbox guarantee.

A local project uses its persisted opaque Zuse project UUID scoped to the enrolled environment. Register that mapping through the owner-authorized flow; the API stores metadata and tombstones, never treats an arbitrary path or repository URL as identity. Moving/renaming a project retains its UUID; deleting/recreating it receives a new identity and no inherited grants. Worktree projects get their own IDs; copying access is explicit consent. Relinking an environment fences the old mapping/grants. Local and cloud checkouts of the same repository are separate targets unless the owner explicitly associates them; association offers settings reuse but never grants authority based on URL equality. No existing cloud-project table is assumed to register all local projects automatically.

### Resource constraints are part of consent

Enablements and grants contain versioned resource constraints in addition to action groups: stable repository IDs/installation IDs for GitHub, allowed teams/projects for Linear where enforceable, and permitted Customer.io workspace/region, resource sets and attribute fields for the selected API. Each connector owns canonical argument normalization and verifies those constraints before every tool/subcall. Alternative names/URLs, aliases, GraphQL variables, nested calls, redirects and batched requests cannot bypass the resource check. Unknown/uninspectable operations are denied or require a separate explicit broader grant; do not advertise resource restriction that cannot be enforced.

Where supported, mint provider credentials narrowed to the approved resources and permissions as defense in depth. The existing GitHub broker chooses a token for an installation; it is not evidence of per-plugin repository/token narrowing. Extend its shared minting seam or add an explicitly scoped broker operation, with exact tests, before reusing it for selected-repository plugin consent. Provider token metadata is never a substitute for host-side dispatch authorization.

## Catalog, publishing and installation

Create a declarative `zuse-plugin.json` schema in contracts, with validation/behavior in a focused plugin package or service module. Required fields: immutable publisher/id/version, display name, summary, icon asset digest, license, supported service/regions, auth requirements, exact transport/spec digest, allowed upstream domains, declared tool/action groups, default approval policy, host API range, changelog/support URL. No arbitrary publisher JavaScript, executable lifecycle hooks, downloaded npm modules, or raw SVG/HTML rendering in v1.

Manifest versions are immutable and server-pinned. Catalog publishing requires ownership verification, review of endpoints/scopes, deterministic validation and a release signature. Pin imported OpenAPI/GraphQL schemas. For mutable remote MCP servers, pin the catalog tool schema snapshot and detect drift; quarantine newly added/widened actions pending review rather than treating TLS or a signature on the listing as proof of remote behavior.

Publishing path: local author CLI validates manifest and fixtures → PR/submission record → CI validates schemas, fixtures, malicious input and declared hosts without release credentials → protected maintainer release job signs/publishes immutable versions → catalog exposes approved versions. Start with first-party packages but ship the documented submission workflow and example package; add delegated community publishing after ownership, revocation and abuse workflows are proven. Do not imply open marketplace publishing is available before it is.

Installation snapshots the chosen version and requested permissions. Connection bindings belong to workspace/project enablement records, not the account-wide installation. Each grant snapshots requirement→connection IDs and binding revision; changing one project never switches the account in another active session. A global default is only a suggested selection, never authority. Display compatible connected accounts, let the user select one or connect a new one, then explicitly enable a grant. Reads may be allowed by default only after this consent; writes default to Ask, high-impact/bulk actions disabled until separately selected. Multiple accounts have stable IDs and labels; no implicit first-account fallback when a binding disappears.

Update: prepare candidate definition → diff actions/scopes/domains → user consent when permissions widen → validate against staged installation bindings → atomically activate a new installation revision. Keep last good revision on failure. Existing executions remain pinned to their version unless revoked; subsequent sessions get the new version. Removal disables dispatch first, then cleans installation state asynchronously. Reusable connections remain until explicitly disconnected; show which other plugins use them. Revocation disables all affected dispatch immediately, retaining history/audit references.

### What authoring looks like

Use separate `plugins/official/<plugin-id>/` directories, each with a proposed `zuse-plugin.json`, README, pinned API/schema assets, fixtures and behavior tests. Existing `extensions/` packages keep their desktop runtime. A shared SDK/CLI validates declarative plugin definitions; authors do not copy Executor, build another OAuth backend, or embed user secrets. Proposed commands are `zuse plugin init`, `zuse plugin validate` and `zuse plugin pack`; these commands do not exist yet and must ship with M1/M6 documentation and standalone fixture validation.

For example, GitHub Review declares a GitHub account requirement, reviewed GitHub API/tool definitions, read-PR/check/diff actions, an ask-before-comment action and a repository-ID constraint. A second GitHub Issues plugin can bind the same connected account but has its own version, declared actions, grants and lifecycle. Installing Issues cannot silently extend Review's consent. A third-party author supplies metadata/specs/tests, submits for review, and gets a publisher-owned immutable catalog version; users see the publisher and requested access before adding it.

Publishing a definition is not permission to use provider branding, impersonate an official provider, or obtain provider OAuth approval. Provider registration and release verification remain explicit. Do not list unverified connectors as working merely because a manifest imports successfully.

## Connecting accounts and approving actions

Managed OAuth uses Zuse-owned provider applications and registered HTTPS callbacks. Provider browser pages still display the provider's branding and consent. Persist single-use state bound to tenant, subject, installation and project enablement, intended provider, PKCE verifier where supported, exact callback, initiating request and expiry. Browser return/deep link carries only an opaque completion ID. The initiating Zuse session polls/verifies completion; a different logged-in user cannot adopt it. Cancelled, replayed, late and wrong-account callbacks do not activate a connection.

API-key providers use a compact provider-specific form with region and requested scopes; send directly over authenticated TLS to the plugin service and encrypt there. No provider secret enters chat, renderer persistence, logs, telemetry, source checkout, or an agent environment. Secrets are encrypted with tenant-bound context and rotatable keys held in the deployment secret manager. Concurrent token refresh uses a durable per-connection lock across replicas. A crash during rotation must preserve a recoverable encrypted result and never retry an old refresh token blindly.

Reuse existing GitHub App installations only with explicit plugin consent and verified sufficient permissions. Extend neither repository access nor app scopes implicitly. Keep cloud build/provisioning access independent; disconnecting a plugin account must not accidentally uninstall the GitHub App or break cloud checkouts. Present affected consumers when a broader disconnect is requested.

Approvals are durable records bound to tenant, subject, session, installation revision, exact connection IDs/binding revision, exact tool, argument digest and expiry. Existing generic permission UI can render them, but the authoritative decision lives in the service, not in the model. Ask once before a specific write; show provider/account/action/target and a bounded preview. Any argument change invalidates approval. Concurrent approve/deny uses a single transition; restart/reconnect cannot execute it twice. Code execution with multiple tool calls is gated at each dispatch, not blanket-approved at the outer `execute` tool. Pending approval survives desktop closure but expires safely. The same pending item may be viewed from another authenticated Zuse client without cross-account disclosure.

For mutating calls, use provider idempotency when supported. A timeout after dispatch becomes `outcome_unknown`; do not replay automatically. Offer Inspect result / Retry with explicit confirmation. Exactly-once effects across arbitrary third-party APIs cannot be guaranteed.

## Data ownership and migrations

New managed functionality requires migrations, unlike the current BYO-only feature. Suggested control-plane entities: `api_plugin_tenants`, `api_plugin_installations`, `api_plugin_enablements` (per project/environment bindings), `api_plugin_grants`, `api_plugin_operations` (durable outbox/reconciliation), and minimal indexed connection summaries. Actual provider tokens, OAuth pending state, approvals/execution state and sensitive connection data belong to the plugin service's store. Store IDs/status in the API, not a second credential copy. Define authoritative ownership for every field; refresh projections from versioned events/reconciliation.

Unique tenant per account; unique active installation per tenant/plugin identity with multiple project enablements and their independent account bindings. Composite account/tenant keys guard reads and writes. Index owner/status, operation next-attempt, grant environment/generation, and installation plugin/version. Audit entries record actor, target IDs, decision, revisions and correlation IDs; no raw tool arguments/results by default. Retention and support access must be configured before launch.

Deploy additive schemas and backward-compatible service API first. Never change existing cloud `ZUSE_USER_DATA`, chat databases, auth images, or provider login ownership. Do not backfill a managed tenant for every Zuse user or copy BYO secrets. Existing BYO state remains unchanged behind Advanced. On explicit transition to managed mode, revoke the runtime's prior bridge sessions, preserve BYO configuration disabled, and require new chats; switch-back also revokes managed session grants.

Account deletion first fences all grants and callbacks, then durably deletes provider secrets, pending approvals, tenant data and projections. Retry until verified completion. Retain only the documented tombstone/audit policy; delayed callbacks/jobs cannot recreate a deleted tenant. Follow existing account-deletion identity ordering so a failed external cleanup is observable/retryable. Back up service data plus encryption key versions and test restore into isolated staging. A new grant epoch invalidates old tokens but is not enough to protect against new grants minted from restored stale consent. The control plane owns the current enablement revision/deletion/revocation ledger, durably replicated or append-only backed up independently of the service snapshot. After a service restore, block grant issuance and credential use until all restored consent/account rows reconcile against that current ledger. After a control-plane restore, reconcile against its surviving ordered revocation journal before serving grants. If neither trusted authority survives, fail closed and require fresh consent/reconnection for affected bindings; do not infer that an active account means old consent is valid. Test a still-active account with a previously revoked binding requesting a *new* grant after restore. The recovery authority and its own disaster backup need an implemented runbook before release.

## UX specification

Keep Settings → Plugins and the current desktop design. Top-level segments: Marketplace, Installed, Accounts. Show signed-in Zuse identity and selected environment as secondary context. Install/account management is account-wide; a labelled “Available in this workspace” control manages the selected runtime/project grant. Never make a global disable look like a local-only action. Advanced BYO is collapsed and labelled separate from managed access.

```text
Plugins [Marketplace | Installed | Accounts]         [Search h-7]
  GitHub Review     Review PRs and checks             [Add h-7]
  Linear Tasks      Work from an assigned issue      [Add h-7]
  Customer.io       Inspect customer context        [Add h-7]

Detail → purpose + real example + publisher/version
       → requested access + data handling
       → [choose existing account / Connect account]
       → [enable for this workspace] → Ready / start new chat
```

Existing installed entries show Installed, Connected/Needs account, and version; no duplicate “Add” card implying another install. Search matches purpose/provider/publisher; categories help browsing. Details show exact supported files/services and expected auth steps. Connection is shown with service/account labels, never raw Executor tenant IDs. Include a Try it prompt and a selected supported agent; starting it requires an ordinary explicit composer send.

| Flow | Loading | Empty | Error | Success / partial |
|---|---|---|---|---|
| Catalog | Lightweight skeleton; cached results labelled stale | Search reset or clear unavailable explanation | Inline retry; installed tools still listed | Add/Installed/Update available per row |
| First install | Preparing your plugin account, cancellable UI | Sign in to Zuse; retain selected package | Setup failed with retry, no duplicate tenant | Account picker or Connect account |
| Browser connection | Waiting for browser; reopen/cancel | No accounts: Connect account | Denied/expired/wrong account with specific recovery | Return to exact plugin, label connected account |
| Permissions | Access preview and action groups | No grant: Enable for this workspace | Revoked/unsupported runtime, update action | Ready; “New chat required” for clients with static tools |
| Approval | Pending action with expiry | None pending | Expired/changed/revoked; cannot approve | Approved once / denied / outcome unknown |
| Update/remove | One pending action; disable duplicate submit | Nothing installed: browse marketplace | Last working version retained; retry visible | Changed version / removed; connection retention explained |

At 720×480 retain list and primary action; detail becomes an in-pane screen with Back instead of squeezing a second column. Use semantic landmarks, keyboard traversal, visible focus, status/alert announcements, focus return after browser launch, and icon+text states. All visible compact controls h-7; coarse pointer hit areas expand to 44px as DESIGN.md specifies. Seven locales; long translations, reduced motion, dark/light themes. Native mobile marketplace UI is subsequent work; mobile must not display enabled managed actions that it cannot approve safely.

### Exact navigation and recovery contract

Every detail/access screen names both project and environment: “storefront · Local Mac” or “storefront · Cloud”. The primary action is “Enable in storefront · Cloud”, localized with a short accessible label when space is tight. With no active project, install/connect remains available but access requires selecting a registered project/environment. Pending operations retain their original account/project/environment IDs. Switching context never retargets an in-flight request; completion is recorded under its original owner and offers a link back. A changed signed-in account cannot display the old completion.

Installed status is account-wide and secondary. The selected workspace's primary status follows this order: Blocked/revoked (explain) → Disabled globally (Enable plugin) → Unsupported runtime (Update / choose supported agent) → Needs account (Connect/replace binding) → Not enabled here (Review access) → New chat required (Open new chat) → Temporarily unavailable (Retry/status) → Ready (Try it). An unverified agent is visibly Unverified and not silently treated as supported. An update badge is independent of usability. Try it opens an ordinary new composer in the named project/environment, selects a verified supported agent where available, and inserts an example request containing no secrets; the user still sends it explicitly.

Accounts rows show provider icon/name, user-editable label, verified provider identity, connection health and number of bindings. Account details list each affected plugin + project + environment, with Rename, Reconnect and Disconnect. Reconnect verifies the returned provider identity before reusing existing bindings; a different identity requires explicit replacement consent. Replacing a missing binding affects only the selected enablement. Disconnect previews every affected binding and cannot be mistaken for removing one plugin.

Pending plugin actions appear in the existing originating conversation as a permission item, and in Plugins → Installed → Pending actions with an originating conversation link. Show the account, operation, bounded arguments preview, expiry and current state. On restart, reconcile the durable approval with the same session/generation before enabling Approve. If the originating session is no longer resumable, show “This request can no longer resume”, disable approval, and offer Dismiss / Open conversation to request again. Never execute an orphaned write or silently transfer its approval to a new session. Outcome-unknown items stay in that conversation and pending/recent actions view with Inspect result; explicit Retry creates a new request, not replay of an old approval.

Browser handoff: pending attempts are saved server-side and listed in the initiating plugin detail and Accounts as Waiting for browser, with Reopen / Cancel. Closing or navigating away from Zuse does not lose the attempt. Browser completion says “Account connected. Return to Zuse to review access”; deep links contain only opaque attempt IDs. On manual return, reload or deep link, fetch the authenticated result, show verified account and original target, and require the normal access confirmation before enabling a grant. Expired attempts offer Start again; cancelled/old callbacks never create an enabled grant. Restore focus to the connection result header or initiating control, and announce the state to screen readers.

A new user should understand purpose in five seconds, connect and perform one useful read in a few minutes excluding provider/admin consent, and later find/revoke every account and grant. No generic hero dashboard, token counter theater, or low-value sample panels.

## Limits, failure handling and operations

| Boundary / error | Recovery | What user sees | Required proof |
|---|---|---|---|
| Invalid catalog/signature/schema/host | Reject before activation | Version unavailable; existing install retained | Tamper/redirect/drift tests |
| Provisioning timeout/duplicate/crash | Idempotent outbox with bounded exponential retry; visible terminal state | Preparing / Retry setup | Crash before/after remote commit |
| OAuth denied/state replay/tenant mismatch | Reject callback; cleanup pending attempt | Cancelled/expired; reconnect | Real browser + adversarial callback tests |
| Credential expiry/refresh conflict | Serialized refresh, fail closed on lost rotation | Reconnect account | Cross-replica rotation test |
| Service down/rate limit | Bound requests; honor retry-after for safe reads; no automatic mutation replay | Plugins temporarily unavailable; normal chat works | Fault injection and independent session checks |
| Revoked environment/account/install | Deny dispatch and approval resume | Access removed | Existing MCP session after revocation |
| Provider write timeout | Preserve outcome_unknown, inspect before retry | May have completed; check result | Recorded side effect + dropped reply |
| Disconnect/removal concurrent with call | Fence before cleanup; already-dispatched call may finish | Clear scope of removal; affected plugins shown | Race test with blocked upstream |
| Malicious spec/remote MCP | Enforce egress allowlist, DNS/IP/redirect checks, bounded import and tool output | Connector quarantined with explanation | Private IP, rebinding, metadata endpoint, link/HTML tests |
| Restore/deletion lag | Fence issuance/use; reconcile independent current revocation ledger; fresh consent if lost | Reconnect/retry deletion; no silent resurrection | Restore from pre-revocation backup |

Per-tenant and per-session quotas, fairness, bounded request/response sizes, deadlines and cancellation are required; one slow connector must not occupy all dispatch slots. Do not put a catalog/provider health fan-out on chat startup. Serve a signed/validated cached public catalog and tenant-scoped installation projection; paginate (initial 50, cap 100) and cache only with tenant/user/policy/revision keys. Cache no authorization decisions across revocation without a proven invalidation bound; prefer live checks.

Initial targets to validate in staging: warm catalog/installed list p95 <300ms server time; grant creation p95 <500ms; existing chat startup adds <200ms p95 with a valid lease and no connector I/O; authorization overhead <100ms p95 excluding provider execution. These are targets, not measured claims. Exercise 10× anticipated concurrent tenants and a slow noisy neighbor; bound resident memory/queued jobs and DB pool usage.

Metrics: install→connect→first successful tool completion, a second successful session, repeat local/cloud use, reconnect/approval abandonment (aggregate counts without prompt/tool payloads), auth/refresh failures by connector, provisioning backlog age, denied/revoked dispatch, approval wait, outcome-unknown writes, p95/p99 latency and saturation. Redact secrets and arguments. Correlate IDs across API/runtime/service. Provide runbooks for provider outage, OAuth app rejection, key rotation, stuck tenant provisioning, connector quarantine, deletion lag and rollback. Infrastructure/usage costs are recorded by tenant; commercial pricing is a separate product decision, not automatic cloud-compute billing.

## Implementation and PR order

Keep the rebased existing four-PR stack reviewable; it is infrastructure, not the marketplace launch. Do not merge it on the assumption the managed experience exists. Subsequent implementation uses `gh stack` in these layers:

| Layer | Deliverable | Depends / acceptance |
|---|---|---|
| M0: feasibility spike | Pinned Executor adapter; auth/tenant/DB/secret/approval proof; real connector capability matrix; version/notice review | Two isolated Zuse users, two same-provider accounts, denied write, grant revocation and restart pass. Stop if provider seams or persistence are unsuitable. |
| M1: contract + catalog | Declarative manifest, immutable first-party catalog, author fixture and validation CLI, release signing job | Malicious/tampered manifests rejected; offline catalog works; no runtime code execution from packages |
| M2: managed service | Container/CI, DB migrations, encrypted credential store, tenant lifecycle, API internal identity adapter, backup/restore | Real multi-tenant isolation and credential rotation/deletion pass; no stock single-org shared instance |
| M3: Zuse provisioning + grants | API records/outbox, first-use provision, runtime enrollment/refresh/revocation, managed/BYO resolver | Local and cloud identify same account automatically; wrong environment/generation/tenant rejected |
| M4: connections + approvals | Browser OAuth/API-key account flow, reuse/binding, policy editing, durable per-action approvals, reconnect/disconnect | Cross-user callbacks, concurrent refresh and ambiguous writes covered |
| M5: marketplace UX + official plugins | Marketplace/Installed/Accounts, details, versions, account picker, permissions, errors, three real packages | Complete useful workflows in Claude + Codex, packaged desktop, real cloud |
| M6: lifecycle + publisher release | Permission-aware updates, rollback/quarantine/removal, documented submissions/review, operator guides, launch material | Clean account first-install and update/revoke/remove tested; protected publishing works |

Private vertical-slice checkpoint: immediately after M0, implement the minimum production-shaped pieces of M1–M5 needed for GitHub Review, hidden behind a staff flag. A clean Zuse account must discover it, auto-provision, connect, choose account/project access, complete a read and an approved write in Claude and Codex locally and in cloud. Validate repeated usefulness with intended users before expanding connectors and publishing UI. This checkpoints the product early; it does not waive isolation, revocation or public-release lifecycle gates.

M1 can be implemented in parallel with M2 after M0 locks interfaces; M3/M4 share API/service modules and should be sequenced. UI against agreed contracts can proceed separately after M1, then integrate after M3/M4. Do not create simultaneous uncoordinated edits to contracts, API migration numbers or catalog signing. Deployment ordering: provision secrets/DNS/DB → additive migrations → service → control-plane flags off → compatible runtimes → desktop UI → staff allowlist → staged users → public enable. Merge order does not imply launch readiness.

Migration rollback: disable new installs/managed dispatch, retain data and readable UI, roll back compatible app/container revisions; never drop new tables or restore secrets over newer state automatically. Connector-level kill switches isolate a broken plugin without stopping all agents. No changes to cloud runtime data directories.

## Verification and release gates

The companion test plan maps every new path to unit/integration/browser/live tests. Existing tests cover BYO parsing, key persistence, proxy revocation, UI request routing, driver config and ACP transports. Managed tenancy, signing/publishing, OAuth callbacks, scoped grant issuance, approvals, updates and cross-device sharing are new unimplemented tests, not inherited coverage.

Required CI: applicable Biome, architecture/API terminology, all workspace types, server/renderer/agents/API unit and integration checks, catalog/release tamper tests, standalone author fixture, i18n, documentation links and existing renderer bundle budgets. Avoid adding Executor to the renderer bundle; lazy-load marketplace UI.

Release gate: two independent real accounts; clean-machine install; real macOS desktop + real cloud workspace; Claude Code + Codex + ACP HTTP/stdio; two simultaneous local/cloud projects bound to different accounts for one service; allowed read + denied/approved write; expiry/offline/restart; policy narrowing in existing session; update permissions; disable/remove; deletion and restore drill; provider credentials and signing credentials provisioned; OAuth callbacks approved; documented on-call rollback.

No authenticated live Customer.io/Linear workflow, Zuse-managed service deployment, public OAuth provisioning or macOS managed flow has happened in this planning turn. These remain explicit blockers for release. No new commercial promises from the plan alone.

## Scope decisions and future work

Included: usable first-party marketplace, real accounts/actions, automatic personal tenancy, local/cloud grants, version/update/removal, submission path, security/operational lifecycle, documentation. This is a multi-PR feature, not a rename of the current form.

Deferred with rationale: team sharing/organization admin (requires real Zuse team authorization); arbitrary executable community packages (requires a separate sandbox/supply-chain model); native agent hooks/skills translation (different compatibility contract); plugin payments (publisher economics unvalidated); mobile marketplace management (desktop launch first); automatic import from personal Executor/other products (credential ownership/consent); offline managed execution (remote services require network). Capture these in this plan's follow-up list without adding unrelated implementation to the current stack.

Current → planned → later:
`BYO endpoint + MCP bridge → Zuse sign-in + managed marketplace/accounts + useful agent actions → reviewed third-party publishing + teams + optional portable workflow components`.

## Decision audit

| Decision | Classification | Rationale / rejected option |
|---|---|---|
| Zuse-owned managed UX; BYO advanced | User-confirmed premise | Meets requested ecosystem; manual URLs do not |
| Embed behind owned service | Architecture recommendation | No verified hosted white-label provision contract; preserve replaceable adapter |
| Personal tenants first | Scope recommendation | Current auth is account-based; no invented team membership |
| Declarative plugins first | Scope recommendation | Real cross-agent value without pretending native hooks translate |
| First-party launch plus documented reviewed submissions | Distribution recommendation | Useful launch and a real author path; delegation follows proven ownership checks |
| Per-session grants and per-tool approval | Correctness | Current runtime-wide capability insufficient for project/account policies |
| Keep credentials in managed service | Correctness | No desktop→cloud refresh-token copying |
| Preserve BYO state and chat databases | Migration | Additive managed state; no automatic conversion or data-path changes |
| No auto-retry ambiguous writes | Correctness | Third-party exactly-once execution cannot be promised |
| Separate provider token authority from cloud agent auth | Boundary | Different data owners and permission models |
| Bind accounts per project/environment | Review correction | Concurrent work/personal usage must not change other sessions |
| Private useful vertical slice after M0 | Sequencing | Validate adoption before broad connector/publisher work |
| Separate interactive management and runtime execution scopes | Review correction | A runtime must not widen access or approve itself |
| Version resource constraints and normalize arguments | Review correction | Action permission alone does not enforce repository/field consent |
| Reconcile restore-independent revocation authority | Review correction | Token epoch alone cannot prevent fresh grants from stale restored consent |
| Register opaque local project identities | Review correction | File paths and equal repository URLs do not confer authority |

### Engineering constraints for M0

Use published, pinned SDK/host exports or build immutable vendored dependency artifacts through CI, never imports from a local reference checkout. Verify runtime exports/declarations in a standalone service fixture; do not assume repository source paths are published APIs. Keep upstream Effect/runtime versions behind the service boundary if they differ from Zuse's version.

The execution sandbox must not bypass policy with direct HTTP, generic admin tools, account creation, credential reads, or nested tool dispatch. Restrict its host bindings to the authorized tool dispatcher; review any raw network facility against the same egress/permission model. Guard every privileged host-side call, not only the JSON-RPC method. Unknown tool semantics default to denied/approval, not read-only because a listing says so.

A provider may invalidate an old refresh token before the new token can be durably saved. If the process dies in that interval and the provider offers no recovery/idempotency, reconnect is required; the system cannot promise lossless rotation across that external boundary. Detect the ambiguous refresh state, preserve evidence without tokens in logs, and stop retrying the stale credential.
