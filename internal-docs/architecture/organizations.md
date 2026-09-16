# Organizations and collaboration authorization

## Implemented boundary

Settings → Organizations supports listing and creating organizations, viewing members,
email invitations, revoking pending invitations, changing roles, and removing members.
The renderer uses the existing control-plane RPC connection. The server calls the
existing authenticated API client; no second account registry or connection transport
is introduced. The feature is not gated by the Cloud Workspace beta flag.

WorkOS is authoritative for account organization membership. Only the API holds its
server API key. Organization administration uses `admin` and `member` role slugs;
workspace collaboration retains its separate `owner`, `driver`, and `viewer` roles.
Unknown organization role slugs never imply administrative authority.

This is organization management and a workspace-permission foundation, **not yet
cross-account session sharing**. Accepting an invitation does not disclose personal
environments, issue a connection grant, or expose terminal/file/agent RPCs. Existing
same-account remote access remains unchanged. Do not broaden environment discovery
or reuse the host owner's credentials to make organization sharing appear to work.

## WorkOS configuration

- Set the API's existing `WORKOS_API_KEY` alongside its issuer/JWKS configuration.
  Missing configuration fails closed with an unavailable response.
- Configure the `admin` and `member` organization role slugs in the same WorkOS
  environment used by Zuse sign-in.
- Configure WorkOS invitation email delivery and the AuthKit invitation/sign-in
  return URLs for the deployment. Invitations are accepted through WorkOS's hosted
  flow; Zuse does not expose provider invitation tokens or acceptance URLs in RPCs.
- Verify a real invitation acceptance with two accounts before deploying this feature.
  Provider calls in the automated tests are fixtures, not a live WorkOS environment.

Organization creation uses a caller-bound operation UUID and WorkOS external ID.
The same request can resume a failed initial administrator enrollment without creating
another organization. Completed creation cannot be retried to restore a removed
administrator. The settings panel retains the operation UUID for retries while mounted;
it does not promise recovery of that draft across application restarts.

## Authorization and consistency

Every organization API operation verifies the caller's account token and reads active
WorkOS membership. The organization claim in the token is not itself authorization.
Member/invitation IDs are checked against the requested organization before mutation.
Members can read the roster; only admins receive pending invitations or mutate access.
Directory-managed memberships are read-only in Zuse.

Role changes and member removals serialize using a PostgreSQL advisory transaction
lock per organization. The caller and last-admin constraint are rechecked under that
lock, preventing two Zuse requests from removing the last admins simultaneously.
Changes made directly in WorkOS are outside this lock's authority.

SQLite migration 0058 adds the collaboration foundation after main's existing
migrations. `collaboration_teams.organization_id` projects each WorkOS organization
into a distinct team. Organization details synchronize the roster through a trusted
server path, never client-supplied identity claims. Revocation or demotion clears
affected workspace grants; rejoining does not resurrect them. Unchanged roster reads
do not append duplicate audit events.

The projection also records the WorkOS membership ID. A replacement membership is
denied until synchronized, and synchronization clears its old grants even if no client
observed the intermediate removal. The human actor's local ID remains stable for audit
attribution; it is not proof that an old access grant is still valid.

Workspace binding is private by default and belongs to one team. A composite foreign
key prevents grants from crossing that binding. Organization admins map to the local
team's owner ceiling, members to driver, and unknown roles to viewer. A driver's team
membership alone does not grant access to a private workspace. The workspace toolbar
has a lazy-loaded access dialog for explicit sharing, viewer/driver grants, and stopping
sharing. Initial opt-in requires host ownership as well as organization ownership.
Stopping sharing clears grants without deleting chats or files; re-enabling it does
not restore old grants.

The collaboration service rechecks live WorkOS membership for protected operations
through `OrganizationAuthority`. Effective authority cannot exceed either the cached
role or the live role. Revocation and provider failure deny access. Remote lookups run
outside SQLite write transactions; writes recheck local membership within the
transaction. Invitations and organization role changes go through WorkOS only;
there is no parallel local bootstrap, invitation, or member-management API.
The unused invitation table remains dormant to preserve migration history.

## Remaining session-sharing work

The WebSocket transport now carries `ConnectionIdentity` through the existing
Effect RPC request context. It distinguishes local trusted connections, paired
credentials (token ID and optional device ID), and API-signed account credentials
(verified subject and expiration). `authenticateToken` owns verification;
`verifyToken` is its boolean adapter for existing callers. Account grants must
contain both subject and expiry, in addition to matching signature, issuer,
audience, token type, and environment.

RPC payloads and headers are not identity sources. An integration test exercises
two simultaneous connections with forged RPC authorization/actor headers and
verifies that each handler still sees its own transport-verified identity.
Identity alone does not grant workspace authority or turn a paired device ID into
a human account. Existing access remains same-account/private; organization
connections must not be enabled before the remaining authorization below exists.

All public RPCs now carry `RpcAuthorization`. Native IPC and explicitly paired devices
retain existing host authority. Verified same-account connections retain host access;
other account identities are denied by default. The initial guest allowlist covers
`chat.get`, `session.get`, `messages.list`, `session.events`, `session.events.head`, and
`session.messages.page`, and `attachments.read`, each checked against the actual session-to-chat binding and
an explicit workspace grant (or that workspace's organization-owner role).

Account streams recheck external authority every 20 seconds and at credential expiry.
Committed local workspace/grant/member revocations also signal affected active RPCs
directly, without waiting for that timer or another provider call. Subscribers register
before their initial authorization check; mutation and notification cannot be split by
request cancellation. Unchanged WorkOS roster reads do not invalidate streams. Changes
made directly in WorkOS still rely on synchronization or periodic revalidation. Expired
credentials have a distinct error code so the existing desktop/web/mobile connection
supervisors can renew them; permission denials do not trigger retry loops. The narrow
server-side WorkOS membership lookup uses host authority, while general guest RPCs
cannot obtain or use the host's account token.

Successful `organizations.setRole` demotions and `organizations.removeMember` calls
apply their confirmed restriction to the local membership projection before returning.
This clears affected grants and publishes the same revocation signal without a second
roster fetch, so self-removal also works when the caller can no longer fetch that roster.
The update matches both organization ID and WorkOS membership ID; failed API calls,
promotions, and repeated member-role assignments do not erase existing grants. Network
calls remain interruptible; once success is observed, the local commit and notification
are protected from request cancellation. Provider changes with an unconfirmed response
still rely on live authorization and subsequent synchronization.

`fs.readFile`, `fs.tree`, and `fs.listPaths` also accept guest requests for a checkout used by an explicitly
shared, authorized chat. The project and nullable worktree ID must match exactly;
seeing a project does not expose its main checkout or other isolated worktrees.
The RPC boundary installs a server-only file scope. The existing filesystem service
verifies that scope, resolves symlinks against the canonical checkout root, rejects
outside targets and non-regular files, and returns generic filesystem errors to guests.
Directory listings omit outside symlink targets and special files. Recursive listings
track canonical ancestor directories to stop symlink cycles while retaining valid
aliases to a directory through different paths. Existing listing size limits remain.
Local/paired and same-account reads preserve their existing symlink behavior.
This is a trusted-host boundary, not OS-level isolation from a hostile process that
can concurrently replace directory entries on the host.

`fs.watchTree` uses the same checkout authorization and scoped filesystem resolver.
Guest streams verify each changed path, omit outside targets, and sanitize watcher
errors. Deleted paths invalidate only the first missing child of a verified parent;
names below unresolved links are not forwarded. Filtered streams keep contiguous
per-subscription watcher sequences without changing durable session cursors. The
existing RPC revocation and credential-expiry handling closes affected watches.

Session-timeline and file-tree drivers distinguish confirmed `access-denied` from
credential expiry and transport failures. A denial clears the ClientBus cell, fences
late driver/checkpoint updates, and serializes cache deletion after pending saves.
The denial marker survives inactive-cell eviction; optimistic overlays cannot restore
its data. An explicit resource restart or a new connection may reauthorize it, but
cached/checkpoint state stays blocked until a runtime data frame is accepted. Ordinary
offline recovery retains its existing cached-data behavior. This does not retract
data a user previously exported or copied.

Before enabling cross-account environment discovery, finish scoped file mutations
and Git/terminal/agent operations. These remain denied to guests. Account-partitioned
client caches and bootstrap behavior still need verification before any cached data
is shown under a different account; clearing on a later denial is not sufficient.

The renderer now has one account-change boundary (`renderer-account.ts`), fed by
the existing auth resource and auth actions. It distinguishes unknown startup state
from signed-out, keeps same-account token refresh stable, and changes its epoch on
identity transitions (including A -> B -> A). Attachment invalidation subscribes to
this boundary. Failed sign-out recovery reopens the canonical auth stream rather
than restoring a cached previous account, and ignores a late failure after a newer
account transition. The persisted cloud chat catalog now uses account-owned keys;
unknown and signed-out clients do not hydrate it. Identity transitions clear its
projection and staged cloud placeholders. Pending writes retain their captured
owner, and delayed cache loads and catalog refresh/archive responses must match
the initiating account epoch before publishing. Unowned legacy cloud history is
left dormant rather than assigned to the next account that signs in. Tests cover
delayed loads/writes, A -> B -> A, and overlapping refresh completion/failure.
API/cloud transport registrations also capture that account epoch. Account changes
remove their credentials and supervisor registrations, close open physical sessions,
and reject delayed refresh/handshake completion, including A -> B -> A. Local and
manually configured SSH/tailnet transports remain device-owned. Tests exercise the
real registration/acquisition path with mocked physical handshakes; they do not
establish deployed socket behavior. Registration requires an explicit initiating
account snapshot. API grant acquisition/activation and cloud attachment pass that
snapshot; account changes invalidate completion and separate in-flight attachment
and connection deduplication. Cloud wake/recovery also checks identity before
follow-up commands or publishing workspace state. Initial and refreshed environment
discovery discard results from an older account or superseded request. A stale
initial account lookup still allows local SSH/tailnet profiles to load and preserves
a newer account discovery result. Explicit refresh tests cover stale success/failure
and overlapping same-account requests. Account changes now remove API catalog
records/entries, release shell subscriptions, and cancel pending shell activation.
A successful refresh also reconciles servers no longer returned by discovery;
failed refreshes retain the existing catalog. Removing the active API environment
clears its projection and restores the local shell, without removing manually
configured SSH/tailnet profiles. Initialized catalogs refresh after sign-in, but not
sign-out. Startup and explicit discovery skip account lookups while identity is
unknown or signed out. When sign-in discovery races saved device-profile loading,
the saved profile takes precedence and the duplicate API route/subscription is
retired before publishing that profile. Tests cover signed-out startup, that race,
removal, idempotent refresh, device-profile preservation, and
pending activation cancellation. Account-owned ClientBus caches and transient cloud
shells still require separate isolation; releasing a catalog subscription is not
proof that all cached state is inaccessible. Cloud account transitions also unregister
checkpoint, older-page, and activation callbacks, and clear their summary/retry
bookkeeping. Those callbacks capture their initiating account and discard delayed
transcript results; stale activation callbacks reject before accessing the runtime.
Queued chat selection and reconnect work also check identity before running.
Mocked callback tests cover cleanup, fresh registration, delayed checkpoint results,
and opening a chat immediately before sign-out. Durable outbox replay and retained
ClientBus resource state remain separate unfinished boundaries. `ClientCommand`
now supports an explicit device or account owner. Owned commands use a v2 fingerprint
that includes ownership; unowned commands retain the shipped v1 fingerprint (covered
by a fixed compatibility vector). Outbox round-trip/collision tests verify ownership
is preserved and a command ID cannot be rebound to another owner. This metadata is
not server authorization. Account-scoped persistence and remaining in-flight
ownership changes still require implementation.
No legacy pending command is assigned to the next account or deleted by this change.
ClientBus now accepts an optional `commandScopeFor` hook that captures a currentness
check before command admission/cache lookup. It checks that scope again after
receipt lookup, across queued/retry attempts, after outbox persistence, before live
execution/mailbox start, and before returning completed delivery. Losing authority
before delivery preserves the pending outbox row and raises `CommandAuthorityLostError`
without treating it as a definitive server rejection. Tests cover denied replay,
resuming as the permitted owner, cached receipt denial, and revocation during a local
write. The renderer now supplies `commandOwnerFor` and `commandScopeFor` through
one shared policy: fresh dispatch captures device ownership for registered local/
manual routes, or the current account for API/cloud routes. Unknown routes fail
closed. Persisted replay bypasses owner capture: legacy/unowned rows can run only
on device-owned routes and are never assigned to whichever account signs in next.
Account replay requires the stored subject and a current route/account epoch;
A -> B -> A invalidates existing attempts. Account commands cannot be rerouted
through a device profile. Tests cover capture-once, unmodified replay, legacy
denial, foreign-owner denial, and matching account/device behavior. Retained mailbox
cancellation callbacks now check captured authority before sending and again after
the response. Tests cover direct cancel-by-ID and handle cancellation across
authority changes, preserving the original durable acceptance. This prevents new
unauthorized cancel requests; it cannot retract a request already sent while
authorized. Long-lived waits and receipt/cache isolation still require verification. Other
asynchronous cloud actions also need account isolation, as do timeline/
file caches and command outbox is also required before complete isolation.
Verify actual account-grant renewal across a long-lived deployed connection; classifier
and in-memory stream tests are not proof of that complete workflow.

The existing one-shot `workspace.list`, `chat.list`, and `session.list` RPCs now
support guest visibility. Their handlers filter through a server-owned request scope,
derived from live membership and explicit workspace bindings/grants. Validation is
grouped by team (bounded concurrency), with a fresh local projection check after each
provider lookup. Private chats in the same project remain hidden. Unknown accounts or
accounts without visible workspaces receive empty lists. Host and paired behavior is
unchanged.

`workspace.streamChanges` now also supports guest visibility. Committed sharing,
grant, and membership changes wake its authorization refresh; unchanged selections
do not restart the feed. Each new selection reopens the existing workspace snapshot
and live stream under the new request scope. Local revocations clear the selection
before any network recheck, and a revision fence rejects pre-revocation lookup results.
A coalescing queue bounds refresh work; external WorkOS changes are checked every
20 seconds and credential expiry independently ends the stream. The RPC test covers
grant/revoke/regrant on one connection, including a delayed stale authorization read.
The chat/session/creation catalog streams now use the same permission-aware restart
mechanism. Chat snapshots and live rows are filtered by shared chat ID. Session feeds
track only visible session IDs, suppress private removals, and send a removal when a
previously visible session moves out of scope. Replacement snapshots retain the existing
domain cursor; the renderer already accepts snapshots at an unchanged cursor. Creation
operations are filtered by their owning chat in both list and stream RPCs. These are
read surfaces only; agent commands and workspace mutation permissions are not enabled.
An in-flight account request cannot change between host and guest authority if the
host account switches; it must reconnect under a fresh scope. Host catalog streams
drain their pre-authorization change subscription to avoid accumulating unused signals.

Legacy HTTP attachment URLs are deliberately host-only: verified account credentials
must match the signed-in host account, while explicitly paired devices retain access.
Responses use `private, no-store` so browsers do not reuse authenticated downloads after
revocation. Teammate attachment reads use the existing session-scoped RPC; its storage
lookup matches both attachment ID and session ID. Session attachment images already
use scoped previews; non-image attachments now download on demand through that same
RPC, rechecking authority on every click. Unmounting the session cancels a pending
download before browser delivery. Only legacy attachment displays with no session
reference retain host-only URLs.

The renderer clears attachment previews at its account-state boundary (including
optimistic logout), not on ordinary token refresh. Mounted preview hooks observe the
new cache epoch; late reads cannot repopulate the cache or erase a newer pending read.
File downloads likewise discard bytes if account identity changes during the request.
This does not revoke files already downloaded or replace server authorization.

Presence, control leases, notes, CRDT editing, and multiplayer session UI are not
implemented; speculative contracts for them are intentionally omitted.
Continue through the existing durable command
receipts and event cursors described in [realtime-runtime.md](./realtime-runtime.md),
not a parallel chat synchronization protocol.

## Verification

Tests cover live membership checks, cross-organization IDs, admin-only mutations,
directory management, last-admin races, creation recovery, provider outages, response
redaction, pagination, separate team projections, grant revocation, and rejoining.
The real settings component has been exercised with an isolated browser fixture at
desktop and compact widths. No live invitations are sent by that fixture.

English messages use main's localization infrastructure. Other locale catalogs carry
English fallback strings pending human translation/review; they are not certified
translations. No new language is enabled by this change.

Release validation still needs live AuthKit invitations, real two-account authorization,
and eventual multi-client session tests once the sharing transport is implemented.

Chromium native IndexedDB checks also exercise the production timeline and reading-
position adapters with synthetic device/Alice/Bob namespaces: independent round trips,
page-reload persistence, rejection of older checkpoints, and owner-scoped removal pass.
This is storage verification, not evidence of live WorkOS or team-session integration.

### Branch verification on 2026-09-15

- Based on `origin/main` at `512f0f77`, including its auth-lock, installer, and deployment changes.
- Repository unit suite: all 28 tasks passed with Turbo concurrency limited to two.
  This sandbox needed `libsecret`, `rsync`, and a Linux `node-pty` native rebuild.
- Full type checks: all 34 tasks passed; the API and server also passed targeted
  rechecks after membership-ID validation was added.
- Scoped Biome, architecture boundaries, API terminology, and localization checks passed.
- Production renderer build and bundle-budget checks passed (110.5 KiB initial JS
  gzip; 495.9 KiB default-route JS gzip, within the existing 500 KiB budget).
- Organization API: 19 tests passed. Collaboration integration: nine tests passed.
  SSH integration: 11 tests passed. Session-store/telemetry/usage recovery checks
  passed when rerun without competing compiler load.
- Full headless system suite with the renderer bundled: 13 tests passed and four
  failed. All four failures reproduced with branch changes stashed on unmodified
  `512f0f77`: protected-socket connection refused; legacy fixture missing
  its pre-rename configuration table at migration 52; an extra permission request after restart (plus
  an interrupted-fiber rejection); and browser pairing startup failing with
  `LanAuthError`. An earlier missing-HTML failure was resolved by building and
  copying the renderer through the existing packaging script.
- Desktop package tests, real SSH installation across the OS/architecture matrix,
  and live WorkOS acceptance were not verified. Browser settings QA used the real
  component with mocked account API responses, not production credentials.

### Resolved pairing startup failure

The protected-socket and browser-pairing failures above were traced to pairing
requiring LAN address discovery even when the transport already had a resolved
endpoint. This matters on tunnel-only hosts and machines with no routable IPv4 LAN
interface. The auth service now accepts the transport's resolved HTTP(S) base URL
when minting a pairing code. Browser, native, QR, and redemption URLs continue to
come from that single source. Ephemeral wildcard listeners advertise localhost for
their local browser URL; configured public and managed HTTPS origins retain priority.

The production startup, protected-socket rejection, and browser pairing/reload system
checks now pass. Auth integration checks also cover HTTPS, IPv6, one-use codes, and
rejection of credential-bearing, non-HTTP, or unresolved-port endpoints. This fixes
pairing reliability; it does not yet enable account-only or cross-account sharing.
