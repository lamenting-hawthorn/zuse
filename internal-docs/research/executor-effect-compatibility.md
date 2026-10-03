# Executor and Zuse Effect compatibility

Updated 2026-10-01 for the v2 plugin integration.

Zuse retains Effect `4.0.0-beta.102`. Executor v2 at
`50bea37fe5d146701990901a878ea940c5012564` uses the upstream Effect snapshot
`c7d1ffff31a3e2ae0b0b0796b742bddeb797269d` (identifies as rc.115). Mixing their
native Effect APIs is not supported by this integration.

`packages/executor-v2` bundles the SDK, its app framework, the DO SQLite driver,
and its own Effect runtime behind a Promise interface. Only plain values,
Web APIs and the host's Durable Object storage cross that interface. It exposes
no native Effect values to the API Worker. The rest of the monorepo does not
upgrade or resolve against the SDK snapshot.

The source archive, provenance checksum, dependency lock and upstream patches
are committed with the generated adapter. `bun run check-types` in that package
checks reachable upstream and adapter source and compares a clean rebuild with
its generated file. The API's Miniflare tests then exercise the actual bundle
under workerd, including SQL migrations, OAuth, refresh and persisted account
cleanup. API and agent tests exercise the existing Zuse runtime alongside it.

The earlier v1.6.10 `Schema.Defect()` compatibility patch and its Node-only
regression have been removed along with the v1 SDK/plugin dependencies. They do
not apply to v2. On a future v2 update, refresh the pinned source and toolchain
deliberately, rebuild, and run the documented checks before deployment.

See [managed plugin operations](../cloud/managed-plugins.md) and the
[original migration assessment](executor-v2-zuse-migration.md).
