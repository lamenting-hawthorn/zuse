# Battery investigation: supplied diagnostics, 2026-09-29

The six supplied JSON attachments contain five distinct reports (the process snapshot is duplicated). Performance history contains 716 Electron samples, 698 runtime process-tree snapshots, and 285 renderer lag entries, spanning September 28 06:48 UTC through September 29 06:47 UTC. The export declares `truncated: true` and zero parse errors, so absence of an event is not proof it never happened.

## Main/server process is the first profiling target

Runtime process-tree CPU samples for main PID 6546 have a median of 89.95%, mean of 84.84%, and maximum of 400.1% across 372 observations. All 372 corresponding Electron workload samples report zero active agents; they report three to five active terminals, so this is not a controlled idle benchmark.

The latest run, main PID 62348, has a runtime CPU median of 15.5%, mean of 33.21%, and maximum of 195.7% across 173 observations. Its final runtime snapshot at 06:47:44 UTC reports 92.7% CPU for main and 21% for renderer. The adjacent Electron workload sample reports zero agents, terminals, browsers, recordings, and no indexing. The separate process snapshot at 06:48:33 reports main at 45.2%, out of 56.3% total process-tree CPU.

These are sampled CPU values, not energy readings or time-weighted CPU averages. Electron and process-tree CPU percentages use different normalization/sampling; do not directly compare their raw numbers. The recorded machine has 14 logical CPUs. There are too few hidden-window samples for a useful hidden-idle comparison.

## Repeated database and Git work

The trace summary records:

| Operation | Count |
| --- | ---: |
| `sql.execute` | 1,068,337 |
| `SessionDomain.reconcileDurableEvents` | 366,300 |
| `SqlDispatchStorage.allEventsAfterSequence` | 366,060 |
| `RpcServer.git.workspaceSnapshot` | 75,942 |
| `RpcServer.pairing.listNearbyRequests` | 18,734 |

The current session-domain implementation polls durable events every 100 ms while subscribers exist. Its global tail query constrains `stream_kind` and `sequence`, but the previous index begins `(stream_kind, stream_id, sequence)`. An unconstrained `stream_id` prevents a direct composite seek on the global sequence using that index.

A synthetic in-memory SQLite reproduction with 100,000 session events across 100 streams selected a stream-kind scan and temporary sort. One hundred empty-tail queries took approximately 644 ms. With `(stream_kind, sequence)`, the plan became a direct range search without temporary sorting; the same loop took approximately 0.18 ms. This establishes a query-plan defect on the reproduced schema, not the percentage of battery drain attributable to it on the user's Mac. Planner statistics and SQLite versions can affect plans.

Migration 0059 adds that index without altering event contents, polling cadence, or delivery behavior. Integration coverage checks existing-row preservation, tail ordering/filtering, empty tails, and the range-search plan. The index adds storage and write-maintenance cost and requires a one-time build during migration. No user database was modified during this investigation.

Git snapshots are the next investigation target: current watchers emit every five seconds and on filesystem events, and each refresh performs status, review, and content fingerprint work. The count alone cannot distinguish many retained workspaces from excessive invalidations. Capture operation counts per workspace and a main-process CPU profile before changing their behavior.

## Other evidence and limits

- 233 long server garbage-collection warnings support investigating allocation pressure, but do not identify its source.
- 666 failures in the leading `deviceBridge.cloud` error group warrant transport investigation. They do not establish why the two earlier local bridge commands were cancelled.
- Renderer history contains 256 input-latency entries and 29 long animation frames, including delays over one second. Multiple entries can describe one interaction; these are not 285 distinct user freezes.
- The supplied recent-errors list ends September 1 and extends into July. It does not establish a current reconnect storm.
- Long-lived watch/stream durations are subscription lifetimes, not continuous CPU execution. The multi-hour entries in “slowest spans” should not be interpreted as CPU time.
- Diagnostic ingestion shows 51 calls and zero failures in the operation summary. The earlier retry-backoff fix is defensive; this export does not implicate that retry path as the primary drain.

Next measurement: compare the same packaged build/workload before and after migration, and take a main-process CPU profile while usage remains high. Use the [battery investigation workflow](./battery-investigation.md) for controlled foreground/hidden runs and native/JavaScript profiling.

## Follow-up: Git refresh reductions and terminal attribution

The current renderer already routes checkout status, changes, review summaries, and PR state through `git-workspace-client-bus.ts`. Resource identity is environment + folder + worktree; different UI consumers and root-path spellings share one driver. Sidebar rows use cached state. Review patches and PR details are hydrated through the same resource, only when needed. A new zero-budget architecture rule prevents separate Git state RPC owners from being added elsewhere in the renderer.

The shared refresh path was changed as follows:

- Healthy, quiet checkouts reconcile every 30 seconds instead of every five seconds (two periodic snapshots per minute instead of twelve). Recursive filesystem events still refresh edits; unavailable watchers retain five-second reconciliation and retries. Missed native events wait for reconciliation. Remote PR refreshes remain asynchronous: their completed result becomes visible on a subsequent snapshot, which can require another reconciliation interval on a quiet checkout.
- Automatic invalidations use a sliding queue and a one-per-second rate limit. Bursts retain their latest pending invalidation, without unbounded catch-up work. Explicit Git-action/manual refreshes remain immediate through the shared driver.
- Unchanged local fingerprints and PR snapshots preserve the shared renderer view, hydrated details, and persistence state. A regression test verifies that an unchanged refresh emits no UI notification. Reconnect epochs and resource errors still trigger updates.
- Background Git commands use `--no-optional-locks` and `-c diff.autoRefreshIndex=false`. Both are necessary: a local reproduction showed `git diff` still rewriting the index with optional locks disabled alone. The integration test touches a tracked file without changing its contents, then verifies a workspace snapshot leaves the Git index byte-for-byte unchanged. Avoiding these writes prevents reads from generating their own metadata invalidations. These are per-command settings, not changes to the user's Git configuration. See [Git status background refresh](https://git-scm.com/docs/git-status#_background_refresh) and [Git diff configuration](https://git-scm.com/docs/git-diff#_configuration).

Ghostty's WASM parsing and canvas painting live in the renderer (`terminal/ghostty/surface.ts`). Paints are requested for output and display changes, with a cursor-blink timer; they are not evidence of a main-process busy loop. The main/server process does handle node-pty output and subscriptions, so heavy terminal traffic could contribute there. The exported history does not contain the call stacks or terminal byte rates needed to attribute its CPU usage. High main CPU also occurs in a sample with zero reported active terminals, so terminal rendering is not an established explanation.

Validation: 82 Git unit/integration tests, ten renderer Git tests, nine architecture-rule tests, affected package type checks, and applicable Biome checks passed. The repository-wide architecture gate still reports two pre-existing legacy-supervisor violations in `apps/renderer/src/lib/file-tree-client-bus.ts`; the new Git ownership rule has zero violations.


## Live Mac follow-up: cloud sync repeatedly verifies whole checkouts

The local-device bridge captured main PID 62348 at 140.2% CPU on September 29 around 07:18 UTC (installed 0.22.1-preview.2), and a later reading remained 102.9%. A five-second native sample is saved on the Mac at `/tmp/zuse-main-cpu.sample.txt`. It contains substantial Node filesystem completion callbacks, including read/close work. Most JavaScript frames are unsymbolicated, so it cannot assign a percentage to a source function. Large offsets on stripped Electron symbols are not reliable function attribution.

Repeated open-file observations caught the same main process reading cloud-sync checkout source files and content-addressed sync objects. The two observed checkout manifests contain 4,159 files / 70.5 MiB and 4,175 files / 70.6 MiB, with no pending publication entries. Only manifest counts and sizes were inspected, not file contents. These observations identify active cloud-sync verification as a concrete hot path consistent with the native sample, not proof that it accounts for all main-process CPU.

The sync implementation previously SHA-256-hashed every suitable local file during baseline construction, every cached object during cache verification, and local files again during application—even when the remote snapshot was unchanged. Multiple enabled workspaces repeat this work at the existing 15-second hint batching / 30-second reconciliation cadence.

Changes:

- One bounded, in-memory `SyncFileVerifier` belongs to each configured workspace and is shared by local baseline, cached baseline, and snapshot application. Unchanged files reuse a previously computed digest instead of reopening and hashing their bytes.
- Every lookup checks device, inode, mode, size, and nanosecond mtime/ctime. Changed metadata triggers hashing; metadata changes during hashing reject that scan for retry. Fresh timestamps bypass reuse for one second to avoid filesystem timestamp-resolution races (the regression tests exposed this on the test filesystem).
- Cached verification expires after five minutes even without metadata changes. Each verifier retains at most 20,000 paths; restart or reconfiguration starts cold. Existing checksums, ownership journals, path checks, and publication order remain in place.
- Baseline/cache/apply loops check cancellation between files so disabling sync does not wait for the whole verification scan.

A synthetic Linux benchmark over 512 files / 32 MiB measured 180 ms elapsed / 191 ms CPU for cold verification, versus 10 ms elapsed / 10 ms CPU for the warm pass. This measures just the verifier, not full sync or Mac battery life. First scans, changed files, metadata checks, and periodic full verification still cost work.

Validation: all five affected cloud-sync test files pass (17 tests after the additional timestamp regression), including real filesystem download/publication, retry/batching, local edits, corrupt cache objects, replacements, cancellation, expiration, and restart. Desktop type checking and applicable Biome checks pass. The Mac filesystem tracer required a sudo password and was unavailable; no debugger was listening, so a JavaScript CPU profile and before/after packaged-Mac comparison remain outstanding. These checkout fixes are not yet installed on the user's Mac.
