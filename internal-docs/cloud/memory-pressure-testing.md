# Testing cloud memory warnings and recovery

This runbook covers the API recovery policy, Linux runtime telemetry, and desktop
notice for Boat, E2B, and Boxd. Read [the behavior and limits](memory-pressure.md) and
[runtime data recovery](runtime-data-recovery.md) first.

## 1. Establish the change and environment

1. Fetch `origin/main`, inspect the branch diff, and record the commit being tested.
2. Identify the API environment, runtime version, desktop version, provider,
   sandbox size, workspace ID, sandbox ID, chat ID, and session ID. Keep secrets
   out of logs and PR descriptions.
3. Distinguish repository merge status from deployment status. A merged PR does
   not establish which API, runtime, or desktop version a user is running.
4. Use a disposable staging workspace for live fault injection. Never deliberately
   exhaust memory or force-stop a user's production sandbox.

## 2. Run automated checks

Run from the repository root after installing the lockfile dependencies. Run the
following jobs sequentially. Use one test worker, particularly on Small machines;
parallel TypeScript and test workers caused the original incident.

```sh
bunx vitest run \
  packages/utils/test/unit/linux-memory.test.ts \
  apps/server/test/unit/machine-resource-service.test.ts \
  infra/api/test/unit/cloud-workspace-memory.test.ts \
  infra/api/test/unit/cloud-workspace-reconciler.test.ts \
  infra/api/test/unit/cloud-workspace-resume-policy.test.ts \
  infra/api/test/unit/cloud-workspace-ready-status.test.ts \
  infra/api/test/integration/public-api.test.ts \
  apps/renderer/test/unit/cloud-memory-notice.test.ts \
  apps/renderer/test/unit/cloud-chat-registry.test.ts \
  --maxWorkers=1

bunx tsc --noEmit -p packages/utils/tsconfig.json
bunx tsc --noEmit -p packages/contracts/tsconfig.json
bunx tsc --noEmit -p apps/server/tsconfig.json
bunx tsc --noEmit -p infra/api/tsconfig.json
bun run --cwd apps/renderer check-types
bun run check:i18n

git diff --check
```

Run Biome on all changed supported files, including untracked implementation and
test files before committing. After committing, use the PR's full diff:

```sh
git diff --name-only --diff-filter=ACMR -z origin/main...HEAD |
  xargs -0 bunx biome check --no-errors-on-unmatched
```

Capture command exit codes and logs. Investigate failures; do not call a check
passing just because its output file is empty while it is still running.

### What these tests establish

| Area | Required assertion |
| --- | --- |
| Linux readings | Reclaimable cache does not trigger pressure; invalid/missing readings are unknown. |
| OOM evidence | Counter must increase in the same kernel boot and runtime generation. |
| Warning stability | Three low-memory samples trigger a warning; a healthy sample clears it. |
| Compatibility | Missing optional telemetry does not create an OOM claim. |
| Diagnostic failure | Missing files and unresponsive reads return within the timeout without inventing an OOM. |
| Backoff | A fast observer cannot bypass the scheduled memory recheck. |
| Recovery | Freeing memory permits a restart of the same sandbox. |
| Retry limits | Persistent pressure and repeated confirmed OOMs stop automatic attempts. |
| Spontaneous recovery | Authenticated runtime activity clears memory backoff without undoing a requested pause. |
| Data retention | Recovery preserves sandbox identity and the queued launch intent. |
| Explicit Retry | Starts a new retry budget on the retained disk, without selecting a newer template. |
| UI activation | Local, idle, paused, and disconnected chats do not open the monitoring subscription. |

These are automated tests with fake providers and controlled readings. They do
not prove real provider uptime, production deployment, visual layout, or real
end-to-end prompt delivery. Mailbox equality checks are not a substitute for
observing a single execution on a live runtime.

## 3. Validate staging on enabled providers

Deploy the additive API/runtime changes to staging and use a desktop build from
the same revision. Record actual versions, rather than assuming the newest
runtime was installed. Repeat these steps on Boat and E2B, and on Boxd when enabled. For Boxd, also
verify preserved-process hibernation versus cold start, and account for proxy
traffic waking a hibernated guest (see [incident debugging](incident-debugging.md)).

1. Create a chat through the API, send a harmless command, and record its IDs.
   Verify it appears in the desktop and produces a tool result.
2. Inspect `/proc/meminfo`, `/proc/vmstat`, the kernel boot ID, and
   `/var/lib/zuse/workspace/runtime-memory.json` read-only. Confirm the baseline
   belongs to this boot and runtime generation. Do not change runtime data paths.
3. Observe an active chat with ample memory: no warning. Finish the turn, then
   pause the machine: no telemetry-driven wake or continuing live subscription.
4. For the pressure scenario, use a disposable sandbox and a bounded allocator
   with a strict duration and cleanup, or a dedicated test build with injected
   readings. Start below available memory and increase gradually. Monitor from
   outside the runtime. Do not use an unlimited allocation loop.
5. Verify warning appearance after three samples and disappearance after pressure
   is released. Record available memory and timestamps; high process count alone
   is not evidence of memory pressure.
6. For crash recovery, prefer injected provider readings for deterministic OOM
   policy tests. A real kernel OOM exercise is optional and destructive: run it
   only on disposable staging data with out-of-band cleanup. Terminating Node
   manually tests disconnect recovery, not OOM detection.
7. While runtime recovery waits, verify the notice describes memory, retained
   message IDs do not change, and no new sandbox is allocated. Release pressure
   and verify the same chat/session resumes and one queued command executes once.
8. Exhaust the test retry budget: verify a stable failure notice and no restart
   loop. Free memory, click Retry, and verify the original sandbox is retained.
9. Let the original runtime reconnect during backoff: verify it becomes ready
   without an unnecessary replacement. Repeat with a pause request pending and
   verify recovery does not undo that request.
10. Disconnect network access without memory pressure: verify it is not reported
    as an OOM. Exercise missing diagnostics/older runtime compatibility too.

For each run, record: time of pressure onset, first warning, disconnect, first
recovery attempt, available-memory recovery, runtime online, queued-command
acknowledgement, and first new tool result. Include provider, size, versions,
retry count, and whether the sandbox/chat/session IDs stayed unchanged.

## 4. Review the desktop

Check compact composer alignment, localized text wrapping, keyboard navigation,
screen-reader status announcements, and reduced motion. Verify healthy, warning,
waiting, recovering, and failed states. Auth and billing errors must retain their
existing actions. Local chats must remain unchanged. Test an older runtime that
omits `memoryPressure` and a newer runtime that provides it.

## 5. Rollout and evidence

Publish API/runtime support first, validate staging, then ship the desktop notice.
No database migration is required by this change. Record each deployment/release
identifier separately. If a regression occurs, roll back the affected artifact;
do not reset databases, replace retained disks, or force-stop unsaved work.

The PR must report checks actually run, failures or skips with reasons, and live
staging results separately. Do not describe the feature as production-verified
until both provider runs and the desktop checks have been completed.

## Evidence for the initial implementation

Automated recovery, API route, telemetry, and presentation tests passed in this
workspace, along with applicable Biome, types, and localization checks. See the
PR for the results after updating to current main. No live staging OOM injection,
Boat/E2B rollout validation, or desktop visual/accessibility pass was performed
for the initial implementation. Production was not deployed by this work.
