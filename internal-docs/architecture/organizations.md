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
membership alone does not grant access to a private workspace.

The collaboration service rechecks live WorkOS membership for protected operations
through `OrganizationAuthority`. Effective authority cannot exceed either the cached
role or the live role. Revocation and provider failure deny access. Remote lookups run
outside SQLite write transactions; writes recheck local membership within the
transaction. WorkOS-backed teams cannot use the local invitation/role-mutation path
as a competing source of membership truth.

## Remaining session-sharing work

Before exposing a team environment, establish the authenticated human actor at the
transport boundary and enforce workspace grants on **every** session, file, Git,
terminal, subscription, and management operation. Account-management RPCs must not
execute as the host owner for guest connections. Initial workspace sharing must also
be authorized by the environment owner, not any organization admin.

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
  `relay_config` at migration 52; an extra permission request after restart (plus
  an interrupted-fiber rejection); and browser pairing startup failing with
  `LanAuthError`. An earlier missing-HTML failure was resolved by building and
  copying the renderer through the existing packaging script.
- Desktop package tests, real SSH installation across the OS/architecture matrix,
  and live WorkOS acceptance were not verified. Browser settings QA used the real
  component with mocked account API responses, not production credentials.
