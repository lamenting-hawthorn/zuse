# Investigating desktop battery usage

Activity Monitor's Energy Impact is a relative score, not watts or battery percentage. A screenshot identifies a symptom, not its call stack. Record the app version, macOS version, machine, power source, window visibility, active agents, local builds, browser sessions, and indexing state alongside each measurement.

## Capture the responsible process

1. In **Settings → Diagnostics**, start a five-minute performance recording, return to the normal workspace, reproduce the high usage, then export the recording. Keeping the diagnostics pane open adds its own refresh work.
2. Repeat with agents/builds stopped and the app visible but idle, then hidden. Keep other applications and power conditions comparable.
3. Compare process CPU, idle wakeups, memory growth, workload transitions, and lag attribution. Inspect the highest sustained CPU process, not only the largest single peak.
4. Include local agent/build descendants. The desktop recorder uses Electron `app.getAppMetrics()`; do not assume it accounts for every independently spawned CLI process. The system benchmark's process-tree capture covers descendants on macOS.

With the Mac bridge, first use `local_device` to locate the bound desktop, then request read-only commands through `local_command_execute`. Its desktop approval is required. If interrupted, inspect `local_command_status` before another request; a cancelled command supplies no measurement.

Use a process snapshot without command arguments (which can contain private prompts):

```sh
/bin/ps -axo pid=,ppid=,%cpu=,%mem=,etime=,comm= | /usr/bin/sort -k3 -nr | /usr/bin/head -40
```

For the hot PID, capture a short native stack sample while the issue is happening:

```sh
/usr/bin/sample <PID> 5 -file /tmp/zuse-hot-process.sample.txt
```

Native samples locate busy threads and native work. For JavaScript function attribution in the renderer, record a short DevTools Performance trace during the same reproduction. Use Instruments Time Profiler for main-process/native CPU work. Native sample output and traces can contain local paths and application data; inspect before sharing.

## Prioritize from evidence

| Evidence | Investigate |
| --- | --- |
| Renderer CPU remains high when idle | Timers, repeated React commits, transcript derivation, layout and paint |
| GPU work stays high | Continuous animation, canvas repainting, visible embedded browser content |
| Main/server process dominates | Synchronous operations, scans, serialization, persistence, reconnect loops |
| Agent/build child dominates | Tool process and concurrency; distinguish useful active work from a stuck loop |
| High wakeups with little useful CPU work | Polling, short retry delays, display work continuing while hidden |
| Growth over repeated session changes | Retained subscriptions, watchers, timers, browser or terminal instances |

Fix the hottest measured path, then repeat the same workload. Use packaged builds for battery comparisons; development tooling affects the result. Run each reference scenario three times and compare medians/ranges using the existing `tests/system/src/power-benchmark.ts` helpers. Include foreground idle, hidden idle, one and four streaming agents, repository indexing, and active/inactive browser scenarios. Compare whole-machine energy only under controlled conditions; do not attribute all system energy to Zuse.

## Changes from the initial code audit

- Diagnostic upload failures previously retried every 250 ms indefinitely. Retries now back off from one second to a one-minute cap, reset on success, and cannot be accelerated by incoming logs. The queue remains bounded; completion only acknowledges the entries actually sent.
- The working-status elapsed clock now displays whole seconds, reducing timer-driven updates from ten per second to one. Shared relative-time display intervals stop when hidden and refresh on return.
- The fallback renderer lag probe now stops its interval and pending animation frame while hidden. Native performance observers remain available. Batched lag reporting also clears its scheduled flush when an early batch flush occurs.

These are verified scheduling defects, not a confirmed explanation of the reported Energy Impact. Measure the battery improvement on the affected Mac before making a reduction claim. Further audit candidates include the continuous dither chart animation and active browser focus polling; profile them before changing behavior.

References: [Apple Activity Monitor energy columns](https://support.apple.com/en-nz/guide/activity-monitor/actmntr43697/10.14/mac/15.0), [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance), [Electron process metrics](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics).
