# Organizations

## Ownership boundary

WorkOS owns organization membership and invitations. Only the account API holds
the WorkOS API key. Desktop organization RPCs forward to that API; browser clients
use the same authenticated account operations. Selecting a host never changes the
human actor's identity.

Personal is a single-person workspace. Each organization has separate resources,
settings and billing. The existing Personal owner keys remain unchanged, including
encryption bindings. Organization owner keys are `organization:<id>`.

See [organization workspaces](../cloud/organization-workspaces.md) for cloud
authorization, rollout flags and verification.

## Membership and roles

| Role | Workspace content | Organization administration | Billing |
| --- | --- | --- | --- |
| Admin | Yes | Yes | Yes |
| Member | Yes | No | No |
| Billing | No | No | Yes |

The API checks active WorkOS membership on protected operations. Token organization
claims are not authorization. Unknown roles fail closed. Member and invitation IDs
are checked against the requested organization before mutation.

A person may create one organization; organizations they join do not count toward
that limit. Each organization has five seats, counting members and pending
invitations, including billing-only users. Directory-managed membership is
read-only in Zuse. The last administrator cannot be removed or demoted.

Organization mutations serialize through the existing store lock. Production
currently uses a PostgreSQL advisory transaction lock, including the WorkOS
request. Moving network calls outside this transaction requires a replacement
that preserves creation, seat and last-admin race protection; simply removing the
lock is not safe. Changes made directly in WorkOS remain outside this lock.

## Runtime boundary

Organization cloud chats use the existing cloud workspace authorization and
transport. They do not use a second team registry or local sharing service.

Local laptop and SSH environments remain owner-only. Shared-host access and
self-hosted server management are split out for separate review. The old SQLite
migration slot 61 remains reserved by `0061_shared_host_compatibility.ts`; its
historical ledger name is retained. Previously created tables are not dropped,
and the legacy 58/59 ledger repair remains to protect existing installations.

## Client isolation

Clients capture account and workspace identity for asynchronous operations.
Catalogs, navigation, drafts, transports and durable commands must not publish or
replay into a different owner after switching. Workspace switching does not stop
agents. UI role checks improve presentation; server checks remain authoritative.

## Verification boundaries

Focused tests cover creation and seat limits, role enforcement, stale responses,
workspace isolation, sharing revisions and live gateway permission downgrades.
Passing these tests does not replace multi-identity staging checks.

Remaining review work includes mobile command/cache ownership, bounded organization
mutation locking, and consolidation of duplicated ownership code. Account HTTP
decoding is shared across desktop/browser and mobile. Organization access remains
opt-in.
