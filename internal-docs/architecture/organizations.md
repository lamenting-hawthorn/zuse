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
transaction. WorkOS-backed teams cannot use the local invitation/role-mutation path
as a competing source of membership truth.

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

Before enabling cross-account environment discovery, finish scoped
environment/catalog views and
workspace-scoped file/Git/terminal/agent operations. These remain denied to guests.
Verify actual account-grant renewal across a long-lived deployed connection; classifier
and in-memory stream tests are not proof of that complete workflow.

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

The branch's presence, control-lease, notes, and collaborative-document contracts are
foundation types only. They do not implement CRDT editing, transferable terminal
control, or multiplayer session UI. Continue through the existing durable command
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
