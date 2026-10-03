# Executor v2: Zuse adoption assessment

**Follow-up:** The basic plugin adapter has now been implemented. It uses a
checksummed source archive and isolated bundle, the upstream DO SQLite driver,
and a static catalog runtime. See [current operations](../cloud/managed-plugins.md).
The assessment below records the pre-implementation findings and proposal.

Researched 2026-10-01 against upstream commit
`50bea37fe5d146701990901a878ea940c5012564`. This is source inspection, not a
successful v2 build or deployment. Existing Zuse integration remains on v1.6.10.
See [capability findings](executor-v2-capabilities.md) for the feature inventory.

## Decision

V2 is a promising foundation for a programmable plugin platform. Evaluate it in
an isolated, commit-pinned integration before replacing the working v1 adapter.
For the currently requested catalog/connect/use flow, v2 adds substantial runtime
and packaging work. Schedules, workflows and app data are optional future Zuse
features; embedding the SDK does not automatically expose them in our UI.

## Verified integration differences

| Area | Current Zuse integration | V2 source |
| --- | --- | --- |
| Construction | Tenant, subject, database, MCP plugin, secret provider | Storage, source store, blob store, app runtime, credentials adapter; optional OAuth/lifecycle/workflows |
| Resource model | Integrations and user connections | Providers, reusable accounts, deployed apps and profiles selecting accounts |
| Persistence | FumaDB/Drizzle in tenant Durable Object SQLite | Effect SQL with fumadb-effect and explicit migrations |
| Cloud implementation | Existing API Worker plus tenant Durable Objects | Upstream uses Postgres for SDK inventory, R2 builds, Worker Loader app execution and Durable Objects for app data |
| Dependencies | Published SDK/plugin 1.6.10, one maintained compatibility patch | Private SDK with workspace dependencies, pinned upstream Effect snapshot and repository patches |
| Authentication | Zuse WorkOS and subject-bound connection metadata | Product must still enforce visibility and authorization; owner IDs alone do not authorize access |

Sources: [constructor contract](https://github.com/UsefulSoftwareCo/executor/blob/50bea37fe5d146701990901a878ea940c5012564/packages/sdk/src/contracts/executor.ts),
[storage](https://github.com/UsefulSoftwareCo/executor/blob/50bea37fe5d146701990901a878ea940c5012564/packages/sdk/src/implementation/storage.ts),
[cloud runtime](https://github.com/UsefulSoftwareCo/executor/blob/50bea37fe5d146701990901a878ea940c5012564/apps/hosted/cloud/src/infrastructure/runtime.ts),
[cloud storage composition](https://github.com/UsefulSoftwareCo/executor/blob/50bea37fe5d146701990901a878ea940c5012564/apps/hosted/cloud/src/infrastructure/executor.ts),
[SDK manifest](https://github.com/UsefulSoftwareCo/executor/blob/50bea37fe5d146701990901a878ea940c5012564/packages/sdk/package.json),
[dependency patches](https://github.com/UsefulSoftwareCo/executor/blob/50bea37fe5d146701990901a878ea940c5012564/package.json),
[owner boundary](https://github.com/UsefulSoftwareCo/executor/blob/50bea37fe5d146701990901a878ea940c5012564/playground/sdk/two-users.ts).

The npm registry's `@executor-js/sdk/latest` was still 1.6.10 at inspection.
The SDK manifest has `private: true` and source exports, so a Git branch URL is
not a ready replacement for the published package plus all its workspace deps.
The Effect snapshot is `c7d1ffff31a3e2ae0b0b0796b742bddeb797269d`; compatibility
with Zuse's beta.102 has not been established. The existing one-line v1 patch
does not establish v2 compatibility.

The v2 storage migrator accepts fresh databases or its supported v4 schemas.
Do not point it at our v1 tables and expect conversion. No Zuse v1-to-v2 data
migration was found. Because this integration is not deployed yet, a fresh v2
store may be possible after confirming no staging data needs preserving.

`createRemoteExecutor` explicitly fails with `NotImplemented` in
[construction source](https://github.com/UsefulSoftwareCo/executor/blob/50bea37fe5d146701990901a878ea940c5012564/packages/sdk/src/implementation/create.ts).
Some upstream examples use that facade as sketches; they are not proof of a
working remote SDK. Several README links point to absent `notes/` files.

## Branding and domains

In-process `createExecutor` does not require Executor-hosted URLs or accounts.
The [OAuth options](https://github.com/UsefulSoftwareCo/executor/blob/50bea37fe5d146701990901a878ea940c5012564/packages/sdk/src/contracts/oauth.ts)
accept the host's `clientName`, HTTP client, URL policy and client metadata URL.
Zuse can keep its own API domain and branded callback flow. Upstream's hosted
wrapper sets `clientName: "Executor"`; we would compose the SDK ourselves.
DCR/CIMD support does not eliminate provider-specific OAuth client requirements.

## Proposed migration sequence

1. Produce a reproducible, commit-pinned package set, inspect licensing for the
   reused packages, and prove Effect compatibility in an isolated build. Avoid
   upgrading the entire monorepo based on an assumed match.
2. Build a minimal Cloudflare adapter with only one public MCP app. Decide between
   upstream's proven Postgres inventory path and a separately verified DO SQL
   adapter. Confirm needed Worker Loader/build/storage bindings in our account.
3. Preserve Zuse's existing management contracts, catalog UI, WorkOS identity,
   account isolation, encrypted secrets, URL policy and permission checks.
   Translate connection records into accounts/apps/profiles behind PluginHost.
4. Validate Linear OAuth, refresh/reconnect, revocation, owner checks, callbacks,
   restart persistence, and local/cloud agent calls against the new adapter.
5. Expose codemode separately only after preserving approval on every underlying
   tool call. Then consider opt-in schedules/workflows with saved actor checks,
   run history, cancellation, quotas and cost accounting.

These are recommendations derived from the inspected source, not work already
implemented. No v2 packages were installed in Zuse and no runtime code changed
during this research. Type/behavior checks for a migration are therefore pending;
the existing v1 test results do not validate v2.
