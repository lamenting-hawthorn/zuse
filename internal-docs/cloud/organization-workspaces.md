# Organization workspace rollout

Status: **scoped billing/configuration and gated client integration; not ready to enable or release.**

## Staging deployment — 2026-09-27

The guarded API implementation is deployed to `zuse-relay-staging`, version
`ac7c4637-fb10-4602-a645-e6df7ec32883`, confirmed at 100% traffic. The Mac mirror's
API and package source hashes matched the tested cloud workspace before deployment.
Both `api-staging.zuse.sh` and `api-staging.stuff.md` returned the expected
`401 missing_bearer` response for unauthenticated organization requests.
This is an API deployment, **not enablement of organization workspaces**: both
workspace rollout flags remain off. Production, runtime artifacts and databases
were not changed. No staging migrations were required or executed.

Verification: API type checking, applicable Biome checks, 405 unit tests and
75 integration tests passed. All PostgreSQL tests ran against a fresh disposable
local PostgreSQL 15 database with the existing migrations applied. Catalog tests
now exercise Personal and organization owner keys, including snapshot, incremental
event and deletion isolation. These tests do not establish runtime authorization,
populated production-data compatibility, or authenticated multi-user staging behavior.

Personal and organizations own independent configuration, resources, and billing.
The authenticated person remains the actor. There is no subscription sponsorship,
balance pooling, company entity, or automatic resource transfer.

## Implemented boundary

- `WorkspaceScope` distinguishes Personal from an explicit organization ID.
- API clients use `x-zuse-workspace: personal` or `organization:<id>`.
  Omission is legacy Personal access. Malformed values are rejected. A token's
  organization claim does not implicitly select a workspace.
- `requireWorkspaceAccess` checks live WorkOS membership. Admins may administer
  billing and content; members may access content; the `billing` role may access
  billing only. Unknown and inactive roles fail closed. Existing collaboration
  membership authorization also rejects billing-only and unknown roles.
- Checkout, portal, entitlements, billing summary, usage, and spending caps use
  the resolved owner, not the actor. Organization checkout only supports the
  existing Cloud offer. Email-based legacy subscription claiming is Personal-only.
  Cloud settings display their workspace name and remount on workspace/account
  changes, keeping billing form state separate. Ordinary members do not request
  financial summaries or see checkout/usage controls; finance-only members are
  routed to the Billing surface. These UI restrictions supplement server authorization.
  Checkout receipt tickets also bind the workspace display name: Personal remains
  Personal, and organization names are fetched from WorkOS after authorization.
  Completion pages render the signed, escaped name and ignore URL-supplied labels.
  Legacy tickets without a name remain valid. The billing provider's customer/billing
  name is not repurposed as a workspace name; provider-hosted workspace labeling
  still needs a supported presentation mechanism. See the
  [Polar checkout API](https://polar.sh/docs/api-reference/checkouts/create-session).
- Existing Personal storage/billing keys remain unchanged. New organization
  billing owners use `organization:<WorkOS organization ID>` in existing stores.
  No existing subscription IDs, ciphertext bindings, or runtime data are rewritten.
- Cloud repositories/scripts, images, GitHub configuration and provider credentials
  use the resolved owner in existing stores. Configuration requires an admin.
- Organization requests use `/v1/organization-workspaces/<id>` before the existing
  API route. The header must agree with the URL. Older API deployments reject this
  namespace instead of accidentally writing Personal data.
- The HTTP router rejects organization scope on unmigrated endpoints. Existing
  account-owned WorkOS handlers also reject it when invoked directly.
- Desktop control-plane requests and subscriptions bind scope at one client boundary.
  Organization access requires the server's workspace-scope protocol handshake.
  Account-level organization management remains explicitly Personal-scoped.
- The gated app switcher reuses settings components. Cloud request caches and the
  persisted catalog are partitioned by workspace, preserving existing Personal keys.
  Late responses are fenced. Background runtime connections and command recovery
  use their original owner rather than following a UI switch.
  Connection ownership now survives ticket invalidation; refreshed/re-registered
  tickets cannot change it. Commands with an unknown owner wait for catalog/connection
  recovery instead of assuming Personal. Mixed-owner catalog responses fail before
  reconciliation, and rejected rows cannot stage chat UI placeholders.
- New-chat text/context drafts have workspace-qualified keys (existing Personal keys
  stay unchanged). Workspace switches remount the landing, flushing the old editor to
  its original key. Launch ownership also includes the workspace epoch, so switching
  away and back cannot let an old result select a chat or clear a replacement draft.
  Pending attachment-draft recovery remains open.
- Workspace navigation retains selected chats/sessions, file/review tabs, landing
  draft configuration, and settings location independently in memory. Switching
  clears transient search/switcher overlays and advances navigation revisions.
  Restoring another environment reuses the existing catalog activation with an
  epoch fence; cancelling a pending activation keeps the original saved navigation.
  Account changes clear navigation history. Background shell projections from a
  different workspace cannot replace the active selection. Full visible catalog,
  search-result isolation, and browser verification remain open.
- Active environment entity hooks now expose no chat/session/repository data for
  a different workspace, which also scopes the chat quick-switcher. The sidebar
  filters its computer entries and active folders with the same ownership check.
  Execution context reports empty rather than exposing a stale Personal root in
  an organization, keeping file search and execution panels from using that root.
  Explicitly qualified background activity hooks remain independent of UI scope.
  Scoped settings and multi-client/browser verification still need completion.
- Cloud catalog rows without a represented checkout now appear directly in the
  sidebar using the existing cloud row. Opening one requires no local folder and
  registers the existing environment resolver without inventing a project ID or
  waking compute. Once the live shell arrives, the selected chat's real checkout
  is validated against that shell's folders and activated through the existing
  environment catalog, with a workspace/selection fence. Authenticated deep links
  and browser verification remain open.
- New encrypted transcript checkpoints include optional chat/session/folder context
  read from the existing runtime services. The shared desktop/mobile decoder checks
  that the session, chat, and checkout identities agree. Older context-free payloads
  remain readable with the same schema version, encryption key, and authenticated
  envelope. A cold selection retains the existing timeline in sync-only mode and
  seeds its empty environment shell from authenticated context through the shared
  ClientBus side-request update. Generation/cursor checks, empty-state checks, and
  revocation checks prevent a delayed seed from replacing live data. Paused shells
  are not activated merely to bind navigation. Unit tests cover cold hydration,
  live-data races, and no compute connection/resume calls; real-browser rendering,
  older context-free runtimes, and mobile hydration still need verification/work.
- Renderer cloud catalogs, checkpoint reads, connection management, and mailbox
  commands now select the shared account-HTTP client on hosted web; desktop keeps
  its existing scoped RPC client. Hosted HTTP validates the explicit scope and uses
  both the versioned organization URL namespace and ownership header. Bound clients
  retain their initiating owner across UI switches and fail after account changes.
  Lifecycle polling is shared with the server rather than duplicated. The hosted
  startup gate still requires a linked computer; standalone cloud startup and the
  authenticated Copy link/open-link flow are not yet wired end to end.
- Unsaved text-file buffers are retained in memory when the editor unmounts or changes
  files, keyed by account, workspace, environment, checkout, worktree, and path. Save
  acknowledgements preserve newer edits and cannot mark a different open file clean.
  Restored buffers keep their original disk modification time, so external changes
  still use the existing save-conflict check. Explicit Reload discards that buffer;
  application-restart recovery and browser verification are not yet covered.
- Invitations and role changes support billing-only membership. Finance and unknown
  roles are excluded from collaboration projection; changing a content member to
  billing-only revokes their projected access. All members still count toward the cap.
- Cloud client tickets now bind a human actor and View/Edit permission separately
  from the resource owner. Legacy Personal tickets remain compatible; organization
  tickets without explicit actor/permission claims are rejected. Organization gateway
  upgrades recheck live membership and sharing policy, require a member-aware runtime
  capability, and forward only API-verified actor/permission metadata. The Worker
  strips caller-supplied gateway authority before forwarding to the existing gateway.
- Chat-sharing contracts and the shared API authorization helper now distinguish
  Private/Organization, View/Edit, creator/admin management and named membership
  grants. Missing organization policies fail closed; Personal remains compatible.
  Rejoined memberships cannot recover a prior creator/grant identity. The existing
  workspace store supports revision-checked sharing updates, and generic lifecycle
  saves preserve the current policy. Memory and real PostgreSQL tests cover update
  races and stale writers. The existing cloud list, individual chat reads, transcript
  checkpoint/pages and ticket endpoint now enforce this policy. Private chats are
  omitted from lists and denied by direct ID; billing-only members cannot read content.
  Sharing GET/PUT endpoints permit creator/admin changes with an expected revision;
  named grants must reference unique, active content memberships in the same organization.
  New organization chats copy an admin-configurable default and bind their creator
  to the verified actor and membership. Creation retry keys are member-scoped;
  existing chats retain their policy when defaults change. Defaults use the existing
  WorkOS organization metadata (`zuse_chat_sharing`), with organization-locked writes
  preserving other metadata; malformed stored defaults fail closed. See the
  [WorkOS organization API](https://workos.com/docs/reference/organization).
  Sharing/default operations are wired through the existing desktop RPC and shared
  HTTP control client. The selected organization's settings now include a sharing-defaults
  pane with shared compact selects, admin-only changes and administrator/host-access
  disclosures. Organization cloud chats reuse the existing Share button with a scoped
  Private/Organization, View/Edit and named-grant dialog. Creator/admin access is fixed;
  finance-only memberships are excluded. Read-only members can inspect access without
  changing it. Saves use revision checks; failed saves retain drafts and offer a reload.
  Workspace changes close the dialog and invalidate pending results. Queued chat opens
  also reject workspace changes and mismatched owners. Authenticated links are still
  pending; organization workspaces remain disabled.
- Organization catalog subscriptions currently send filtered replacement snapshots.
  This reflects live membership changes even without a catalog cursor change and
  avoids leaking private tombstone IDs. Personal catalog deltas remain unchanged.
  Snapshot cost and runtime membership-check traffic require load verification before rollout.
- Durable mailbox envelopes now support API-attested organization actor/membership
  metadata. Enqueue overwrites caller claims; Personal envelopes retain their existing
  identity and encryption format. Mailbox deduplication binds an attributed command
  to the original membership, rejecting another actor or a rejoined membership.
  Data-key and command handlers apply chat sharing policy as well as owner checks.
  Before a new organization command executes, the runtime rechecks its author's
  original membership and current Edit permission. Revocation rejects the command;
  authorization outages retry without acknowledging. Committed receipt recovery
  never re-executes the command or depends on the author's continued membership.
  Prompt authors are persisted in existing message content/domain events and survive
  projections and transcript decoding, without a new author registry or database table.
  Receipt validation also checks the original author before acknowledging replay.
  Organization mailbox delivery requires a generation-matched bootstrap receipt
  advertising `command-author-v1`; legacy runtimes cannot lease organization commands.
  Commands may still queue before the first runtime is ready. Organization mailbox
  routes remain outside the rollout allowlist pending end-to-end verification;
  the client author display and multi-client verification still need completion.
  Queued prompts retain their author in the existing input JSON, timeline
  events/snapshots, edits, restoration, and eventual user message, including the
  scheduled-successor/steering path and superseded-turn requeue. Both execution paths
  now use one runtime-wide authorization policy: cloud recovery waits for bootstrap,
  membership/Edit checks retry temporary outages, and denial retains the queued prompt
  paused/held without executing it. Local runtimes deny attributed queues without an
  installed authority. Live prompt
  RPCs use the verified connection author, never a caller-supplied author. Gateway
  connections resolve membership before minting credentials and pin that membership
  for subsequent permission checks, preventing removal/rejoin from reviving authority.
- The existing LAN auth service can now mint ephemeral workspace credentials
  without persisting paired-host tokens. These carry a transport-established actor,
  chat/project scope and a live permission check. RPC authorization restricts scoped
  credentials to explicit content operations, enforces View/Edit and chat/worktree
  ownership, and rechecks long-running subscriptions. Host account tokens and
  unscoped attachment URLs remain unavailable to these credentials. Loopback and
  browser-ticket exchanges preserve supplied authority rather than elevating it to
  local authority. Organization runtime bridges now issue these scoped credentials,
  recheck access through a generation-fenced API endpoint on requests and at most
  20-second intervals during long-running RPCs, and retain the signed View ceiling.
  Missing identity fails closed. Closing the gateway disposes local connections and
  credentials; a pending credential mint cannot resurrect a closed connection.
  Personal runtimes retain their existing compatibility path. Terminal RPCs now use
  a server-bound chat owner through the existing PTY service: View can list/watch,
  Edit can open/write/resize/rename/restart/close. Caller owner IDs cannot select
  another chat or an unowned host terminal, starting directories are server-bound,
  and output streams retain live authorization/expiry checks. Moving checkouts hides
  old-checkout terminals. Bulk client cleanup remains denied. Controller handoff,
  client behavior, durable actor attribution and multi-user runtime tests remain pending.

`ApiConfiguration.organizationWorkspacesEnabled` defaults to false and is only
enabled in tests. It is deliberately not exposed as a deployment environment
binding yet. Do not enable organization checkout before resource isolation is ready.
The renderer switcher is also off unless `VITE_ORGANIZATION_WORKSPACES=true`.
That client flag is not permission to enable staging: the remaining boundaries below
are mandatory.

## Still required before rollout

Workspace-owned, non-secret settings now have an account API at
`GET/PUT /v1/cloud/settings` using the same owner resolution as cloud resources. Values
reuse the existing settings schemas, with device preferences, host paths, and custom
provider credentials excluded. Reads require content access, writes require admin
access, and replacement uses a revision compare-and-swap. Additive migration 0028
does not rewrite Personal runtime settings or resource identifiers. The renderer's
existing settings selectors and actions now hydrate organization values through this
API, serialize local edits, and discard responses after workspace/account changes.
Only explicit device preferences carry across from the local runtime; Personal agent
defaults and host paths do not. One visible-window refresh loop shares remote changes
across selectors. Finance-only workspaces do not require content-setting access to
display their billing shell. Hosted Personal also reads account settings. With the
scoped-client flag enabled, signed-in desktop Personal uses the same account settings.
An empty revision-zero record is initialized from acknowledged local settings through
ClientBus, after the existing legacy-localStorage migration. Only allowlisted non-secret
fields are uploaded. Existing account values win, including concurrent initialization
by another device; a conflict is read back, never overwritten. The original settings
file, device preferences, host paths, and custom-provider credentials remain local.
Signed-out desktop and direct Serve-browser behavior remain on the existing path.
Before rollout, native Personal behavior is unchanged.

Acknowledged Personal settings use the existing versioned resource-cache adapter,
partitioned by account and workspace. Native Personal can use that cache during an
API service outage; permission denial or expired RPC credentials clear it. Cache origin
and offline state are reflected in the existing settings projection. Organizations
never initialize from Personal settings or this cache. Tests cover concurrent first
writes, stale account/workspace replies, credential filtering, account-isolated cache
recovery, revocation, and reading fresh local data instead of stale projections.
Packaged restart and populated-data migration verification remain required.
Denied settings reads clear cached content and fence older in-flight replies; transient
failures preserve the last acknowledged value. Tests cover revision races, queued
writes, account/workspace changes, and refresh-loop cleanup.
The existing desktop control-plane RPC and shared account HTTP client both expose
`cloud.settings.get/update`, preserving revisions and workspace scope. Hosted transport
tests cover workspace switching, conflict responses, and account changes.

The hosted root now registers the browser account client and opens the cloud shell
without selecting or connecting a served computer. Explicit computer links still
require a matching account catalog entry and a successful connection. Browser-owned
appearance, notification preferences, and keyboard shortcuts persist in local storage,
independently of workspace and account changes; failed writes preserve acknowledged
values. Cloud setup reads use the existing account HTTP client and scoped cache rather
than requiring desktop RPC. Checkout, billing portal/caps, GitHub installation,
repository connection/removal, image builds, agent account setup, and cloud chat
creation/recovery now use that same transport. Deferred checkout and authorization
links reserve their browser tab during the click and close it on failure or a stale
workspace response. Desktop and browser share API error classification, including
billing holds, credential requirements, and rate limits. Tests cover these startup
paths, cache isolation, scoped mutations, tab handling, and late responses.
The signed-out screen passed a local Chrome smoke test and automated
WCAG A/AA checks; authenticated full-shell, multi-user, and mobile verification remains
required.

Mobile now has an explicit workspace-scoped account HTTP client using the existing
shared cloud client. It validates the scope, sends matching URL/header ownership,
and binds retained clients to the account epoch; account changes while reading a
response body also reject the result. Error mapping is shared with desktop/web.
Mobile runtime tickets/recovery, queued commands, transcript reads, archive, and
device-bridge requests now resolve their scope from the authorized chat catalog.
Unknown workspace IDs do not fall back to Personal. The mobile catalog and new-chat
creation now accept an explicit workspace selection, clear old configuration on scope
changes, reject mismatched chat ownership, and fence late discovery/provisioning.
Organization launch intents and drafts are separated; Personal draft keys stay intact.
The new-chat form remounts by draft scope to prevent old text from being persisted into
a newly selected workspace. Full role-aware configuration and navigation still need
integration before exposing this flow to mobile users.
Transport/runtime tests are not evidence of mobile organization UI parity.
The shared mobile connection selector now excludes Personal computers in organization
scope without deleting saved pairings. Personal discovery is hidden and does not run
in organization scope; discovery and connection grants are fenced across scope changes.
Inbox/search consume that selector. Organization-enrolled self-hosted discovery
remains unfinished.
Mobile membership discovery now reuses `organizations.list` through the existing
account HTTP transport. It retains admin/member/billing roles, shares concurrent
requests, preserves membership names across workspace selection, and rejects results
from an old account epoch. The home header now reuses the compact native selector for
Personal and organization names, behind `EXPO_PUBLIC_ORGANIZATION_WORKSPACES=true`
(off by default). Selection rechecks membership and rejects superseded selections.
Billing-only members land on a separate financial screen that opens the existing
workspace-scoped billing portal; they do not mount chat home or fetch its catalog.
Membership removal or a finance-only downgrade clears catalog content and invalidates
pending reads without falling back to Personal. Catalog failures preserve the account
workspace list and recover from client initialization errors. The home remounts by
account/workspace to prevent search leakage; restoring per-workspace navigation is
still unfinished. No device QA, packaged mobile build, or staging enablement has been
performed for this switcher. The shared non-iOS selector now opens a scrollable,
compact picker with selected-state semantics, dismissal, and disabled/empty handling;
workspace and member-role selections no longer render as inert labels. Callback and
dismissal behavior has unit coverage, but Android device accessibility and layout
remain unverified. Mobile repository/shared-configuration settings and sharing still
need integration. Organization administrators now have a mobile Sharing Defaults
screen using the existing scoped `cloud.sharing.defaults` endpoints. It exposes
Private/Organization and View/Edit, states administrator access explicitly, and
changes future-chat defaults only. Its configuration authority check is shared with
Cloud Authentication; account/workspace changes and admin demotion invalidate the
form and its pending results. Organization cloud chats now expose a mobile Share
screen through the existing session-actions menu on iOS and its shared-selector
fallback elsewhere. The screen reuses the scoped sharing API and revision checks,
shows administrator/creator access, supports named-member grants and Private/
Organization View/Edit, and copies the existing authenticated locator without
creating a grant. Default and per-chat audience/permission controls share one
component. Finance-only memberships are excluded; retained dialogs and late results
are fenced by account, workspace epoch, and catalog ownership. Unit coverage exercises
those boundaries and revision conflicts. Native save/retry, clipboard behavior,
multi-user revocation, and cross-client propagation still require device QA.
Organization account endpoint/payload mapping has been extracted into the shared
client runtime and is reused by browser and mobile organization administration.
Mobile uses the existing bearer-token transport with account-epoch fencing, explicit
organization limit errors, and no second membership registry. The selected organization
now has a Members settings screen: roster, administrator invitations, role changes,
confirmed removal, and invitation revocation. It reuses the native compact selector
and the contract's five-seat limit, including pending invitations and finance members.
Retained controls cannot mutate after a workspace/account switch or admin demotion;
late and wrong-organization roster responses are rejected. The screen is rollout-gated,
and native device interaction/WorkOS invitation delivery remain unverified.
Mobile Cloud Authentication now binds provisioning, encrypted credentials, device
login start/poll/cancel, and image updates to the selected workspace. The form
remounts by account/workspace epoch; late operations cannot publish into another
workspace or send a credential after a switch during encryption/provisioning.
Only administrators can mount organization credential controls; the server remains
the authorization boundary. Any selected-organization role change clears cached
configuration, including administrator-only authentication metadata. Settings labels
the selected workspace's credentials separately from personal/device preferences,
and Personal pairing controls are hidden in organization scope. Unit tests cover
these control paths and races; real provider device-login and mobile UI verification
remain outstanding.

Mobile shared-chat routing now recognizes the existing `/w/.../chat/...` locator
through Expo's native-intent entry point and retains it across sign-in on a dedicated
resolver screen. Organization links respect the mobile rollout gate and require fresh
non-finance membership plus an authorized catalog match for both chat ID and workspace
scope. Only then does the app select the workspace and open its existing session route;
it neither grants access nor wakes a runtime as part of link resolution. Cancellation,
account/workspace changes, and mismatched ownership reject late results. Unit tests
cover normalization, Personal compatibility, authorization, and these races. Packaged
deep-link/sign-in testing and HTTPS universal-link domain association remain unfinished;
normalizing an HTTPS URL does not yet make the OS open that URL in the mobile app.

The mobile archive screen now queries and mutates the selected workspace rather than
the legacy Personal-only client. It remounts by workspace/account epoch and ignores
late previews, lists, and mutation results; stale delete confirmations cannot execute.
Cloud restore/delete requires an ID from that screen's authorized, ownership-checked
archive result. Listing and mutation races cannot resurrect removed entries. Local
archive discovery requires a connection in the current workspace's visible connection
list, without the legacy raw-host fallback. Finance-only members do not mount archive
content. These paths have unit/type coverage, but archived-chat mobile UI and multi-user
runtime verification remain outstanding.

Mobile route-to-connection resolution now requires a matching saved or cloud connection
in the currently visible connection list. Unknown raw `host:port` routes no longer
create transports, closing the same fallback across sessions, files, review, and
terminal screens rather than patching each screen separately. Existing saved legacy
raw-host keys and environment aliases still resolve; unsaved host links require the
normal Add connection flow. Tests cover legacy compatibility and absent/hidden routes.
The shared session-bundle projection also hides cached Personal computer chats in
organization scope, while preserving their underlying runtime state for return to
Personal. Per-connection consumers use the same projection; switching does not stop
the Personal agents or delete saved data.
All nine mobile connection-backed route screens now share a visibility boundary.
It refuses to mount resource content for missing/hidden connections or a stale account
catalog, and keys mounted content by workspace epoch and route parameters. Access loss
therefore removes cached transcript/file/tool views as well as their resource effects;
route changes cannot retain the preceding file component's state. Saved signed-out
Personal connections remain supported. Rendered boundary tests cover allowed, hidden,
raw-host, loading, and account-transition cases. Native navigation/remount behavior
still requires device verification; this is not evidence of complete mobile UI parity.

Mobile workspace settings now link to the same Billing screen used by finance-only
members. Personal owners and organization admins/finance members can open the existing
scope-bound payment/invoice portal; ordinary members, unknown memberships, and stale
account catalogs cannot mount its controls. Organization access remains rollout-gated.
The screen shows workspace identity and independent-balance semantics, and its captured
workspace snapshot prevents stale callbacks or late responses from opening another
workspace's portal. Rendered tests cover these roles and request ownership. Provider
checkout/payment flows and native browser-return behavior still need staging/device
verification; pricing and metering are unchanged by this UI addition.

Mobile membership discovery is now owned by the account lifecycle, not by a mounted
switcher. The existing catalog timer checks memberships every 30 seconds while active,
refreshes on foreground, and stops on account teardown. Background polling is paused;
temporary membership failures are retried on the next interval without fabricating a
membership removal. Existing catalog revocation/role-change invalidation then removes
open resource and billing views. The switcher retains an explicit refresh action but
no duplicate foreground subscription. Timer tests cover foreground/background, outage,
cleanup, signed-out, and rollout-disabled behavior; server authorization remains the
enforcement boundary, and live multi-client revocation verification is still required.

Mobile cloud handshakes now include the selected-workspace epoch in both late-result
checks and in-flight request deduplication. Switching away and back cannot revive an
old ticket lookup or use its late metadata to resume a runtime. A stale request's
cleanup cannot remove a newer request for the same workspace. Regression tests cover
both ticket and pre-resume races. This changes no runtime storage paths, sandbox data,
or queued commands. Mobile now releases cloud transports removed from its visible
catalog, including selection changes and authorization-driven catalog clearing.
This does not stop remote agents or remove their data. The shared supervisor retires
an entry before awaiting its shutdown, so a same-key reconnect gets a fresh entry;
completion of the old shutdown cannot remove the new one. Removing an absent entry
does not create a transport. Unit tests cover catalog removal and overlapping close/
reconnect; live socket revocation still requires multi-client verification alongside
server-side authorization.

The scoped route allowlist now includes durable command status/watch/enqueue/cancel,
command data keys, and runtime lifecycle actions. Lifecycle changes require chat Edit
permission before entitlement checks or mutations; command reads remain available to
View members. Handler tests cover View mutation denial and billing-role exclusion.
These paths remain behind the organization rollout gate and still require real-runtime
multi-user verification.

Ordinary members can read the existing provider, repository, and cloud-image catalogs
to use organization-owned configuration. Configuration mutations and credential flows
remain administrator-only. Agent availability uses the existing auth-status endpoint:
members receive only authority state plus provider IDs and connection states, while
account labels, verification/error metadata, and encryption metadata are omitted.
Login polling and all credential mutations remain admin-only; finance and removed
members cannot read availability. Entitlements are checked against the organization,
not the member's Personal plan. Image build logs are omitted for non-admin members; Personal
and administrator responses retain them. API tests verify member reads, mutation denial,
owner isolation, and finance-role exclusion.

1. Scope enrolled servers and durable commands, and load-test filtered catalog subscriptions.
   Finish terminal control handoff/client integration and durable actor attribution independently
   of ownership. Verify the new member-aware gateway with real runtimes, multiple
   users and removal during active subscriptions before enabling organization tickets.
2. Finish browser/mobile integration and partition visible chats, tabs, drafts,
   local settings, environments and search. The gated switcher and cache partitioning
   alone do not provide complete UI isolation. Preserve dirty editor contents.
3. Verify authenticated chat links with real accounts and deployed runtimes. Cloud
   sharing now copies workspace-qualified URLs with no access token; hosted startup
   verifies current membership and resolves the target through the authorized chat
   catalog before selecting the workspace. Private outsiders, finance-only members,
   missing chats, invalid scopes, and stale responses fail closed. Organization links
   respect the rollout flag; legacy Personal links stay Personal. Sign-in callbacks
   resolve the restored return path rather than the callback URL. No new chat registry
   or access-grant mechanism was added. Mobile deep-link device verification remains unfinished.
4. Finish workspace identity on provider-hosted checkout and configure the WorkOS
   `billing` role before enabling finance invitations in a deployed environment.
5. Verify populated Personal data and PostgreSQL behavior, real multi-user
   WorkOS sessions, billing webhooks/metering, revocation, and staging isolation.
   Only then expose the staging rollout flag and enable scoped clients.

Automated coverage currently includes scope parsing, role permissions, live
membership removal, provider outage, fail-closed legacy routes, distinct checkout
and portal owners, independent spending caps, and absence of Personal subscription
fallback for an unfunded organization. This does not constitute end-to-end workspace
isolation or a completed migration test.

Additional coverage verifies scoped URL/header agreement, separate repository
idempotency keys and cross-owner deletion denial, cache round trips and late loads,
Effect/Stream scope binding, billing RPC scope propagation, and finance-role revocation.
Workspace lifecycle streams retry temporary service failures only; authorization,
deletion, and billing denials terminate the subscription. Regression tests cover
revocation after an emitted update and transient recovery without duplicate revisions.
The renderer catalog also stops retrying authorization failures and removes cached
chat entries on an authoritative denial. Service outages retain offline entries, and
late denials from a previous workspace cannot clear the newly selected catalog.
Repository settings continue to use the existing runtime commands and repository
configuration file. Their renderer cache is cleared on account/workspace changes;
late reads, writes, and errors cannot repopulate the newly selected scope, including
switch-away-and-back races. This does not yet provide organization-level repository
script administration while a runtime is offline.
Organization preview URLs remain disabled: the existing Personal preview endpoint
issues public-by-URL access and must not be enabled as an authenticated organization
sharing path without a corresponding authorization boundary.
PostgreSQL tests require `ZUSE_TEST_POSTGRES_URL` / `ZUSE_TEST_DATABASE_URL` pointing
to a disposable test database, never staging or production. Passing these tests is
not a substitute for populated-data and multi-user staging verification.

The sharing-defaults component was exercised in a local browser fixture with mocked
control-plane responses (not a staging account): admin save, member read-only controls,
load failure/retry, save failure preserving the draft, keyboard selection and a 390px
viewport. Controls measured 28px; the viewport had no horizontal overflow. Axe's
WCAG 2 A/AA scan reported no violations. Screenshots and the isolated fixture are in
`.context/sharing-ui/`. This does not verify account authentication or end-to-end sharing.

The per-chat dialog was also exercised in that mocked fixture: a named View grant
saved correctly, creator/admin permissions remained fixed, billing-only members were
absent, and a read-only member had disabled controls and no Save action. A failed save
retained its draft, retry reloaded the authoritative policy, and workspace-switch
notification closed the dialog. Keyboard selection worked; controls measured 28px and
the 390px viewport had no horizontal overflow. Axe reported zero violations, with the
shared dialog's focus guards flagged for manual review. These component checks do not
replace multi-user authorization or authenticated-link tests.

The Copy link action was checked in the same local sharing fixture: it produced
`/w/organization/org_a/chat/cloud_a` without saving the policy; clipboard failure
displayed an error without changing access. Read-only members could copy but could
not edit or save. Controls remained 28px at 390px width with no horizontal overflow.
The automated WCAG A/AA scan had no violations, with the same shared-dialog focus
guards requiring manual review. Sharing and sharing-default requests now use the
shared cloud HTTP/desktop transport. These mocked UI checks do not prove deployed
authentication or authorization.
