# Investigating a stuck cloud chat

This is the hands-on investigation workflow: find the affected machine, establish
which layer is failing, collect evidence, make the smallest repair, and verify the
original conversation actually continues. It applies to Boat, E2B, and Boxd. The
[memory test runbook](memory-pressure-testing.md) covers automated checks and
staging verification after a code change; it is not the incident investigation.

## 1. Identify the exact incident before touching anything

Start with the user's chat title, branch, screenshot, or provider sandbox ID. Ask
for the missing identifier only if existing session context cannot identify it.
Record the following in a private, gitignored `.context` incident folder:

- UTC time and the user's last action: create, send, upload, resume, or interrupt;
- production versus staging, API host, and desktop build;
- workspace ID, provider, provider sandbox ID, chat ID, and active session ID;
- API lifecycle state, desired state, status code, runtime state, generation,
  revision, latest activity, and next scheduled action;
- provider state, machine size, latest completed snapshot time, and runtime version.

Use the authenticated account workspace API to map workspace IDs to provider IDs.
For the first-party routes, inspect `GET /v1/cloud/workspaces` and
`GET /v1/cloud/workspaces/{workspaceId}`. Check current route/auth requirements in
`infra/api/src/cloud-workspace-routes.ts`; a public integration API key and a
signed-in desktop account token are not automatically interchangeable.

Do not identify the machine from a branch name alone or assume that the most
recent sandbox belongs to the failing chat. An API row saying `ready` and a
provider saying `running` are observations about different layers, not proof the
agent is progressing.

## 2. Establish access without exposing credentials

Use existing authorized account/provider credentials. Do not replace a user's
secret to get access. Keep temporary credential files private (`chmod 600`),
read them inside the process, and never paste their contents into commands,
logs, a PR, or the incident report. Avoid `set -x`, full environment dumps, and
unfiltered process command lines: credentials can appear in arguments.

When credentials, the installed app, or its SSH alias exist only on the user's
Mac, use the available Mac bridge (`RunLocalCommand`) for those checks. Explain
that the resource is on the Mac. The cloud workspace cannot inspect a Mac app's
logs or use its local SSH configuration by itself. Confirm which app/data folder
is active; do not assume a historical Alpha/Beta path is still the current one.
If authentication has expired, use the normal login/refresh path; do not print
refresh tokens while troubleshooting it.

Bound every probe. Prefer a handful of timestamped requests over an unbounded
poll loop or many simultaneous commands on an already overloaded machine.

## 3. Separate control-plane reachability from guest reachability

Check these independently and record duration, status, error code, and request
ID where available:

1. Zuse API: can the authenticated account read the affected workspace?
2. Provider API: can it return that exact sandbox's details?
3. Guest execution: does a harmless `uptime` command finish?
4. SSH: does TCP connect, does the SSH handshake finish, and can a command run?
5. Runtime/gateway: is the runtime connected for the current generation, and can
   the client complete its authenticated connection?

For Boat, the adapter in `packages/sandbox-providers/src/box.ts` uses
`https://boat.dev/api/v1/sandboxes/{id}` and the sandbox's `/commands` endpoint.
The internal adapter ID can still be `box`. Use the current adapter/docs rather
than guessing provider field names or treating the Box/Boat rename as a failure.
For E2B, use the repository's E2B adapter/installed SDK with the existing sandbox
ID. Do not allocate a new sandbox as a connectivity probe.

### Boxd-specific access and lifecycle

Boxd is a separate provider from Boat (`providerId: "boxd"`); do not send its
machine ID or credentials to Boat's REST endpoints. Follow
`packages/sandbox-providers/src/boxd.ts` and the installed SDK. The adapter uses
`client.machines.get(id)` for metadata and
`client.machines.exec(id, { command, timeout })` for guest commands; its exec
timeout is in milliseconds, unlike the Boat example's `timeoutSeconds`.
Confirm the configured organization and cluster/base URL before looking up a
machine. See [Boxd operations](boxd.md) for configuration and limitations.

The guest-level checks below still apply: Linux memory and kernel logs, process
parents, tagged systemd service, runtime log, SQLite identity, gateway generation,
and mailbox acknowledgement. Boxd shares Boat's tagged process helpers, so the
unit-name discovery procedure also applies. Use the adapter/SDK file reader;
Boat's snapshot-file REST example is not a Boxd recovery method.

Record Boxd's native state before probing its proxy. The adapter distinguishes
`hibernated`, `suspended`, and `stopped`, with wake, resume, and start operations
respectively. Normal hibernation preserves processes; a stopped machine or resize
boots cold. Inbound proxy traffic can wake a hibernated machine, so an HTTP/SSH
probe is not necessarily passive. A failed connection during hibernation is not
by itself a crash. Do not force a restart merely because a warm reconnect takes
time, and do not resize as a diagnostic step.

The memory detector and bounded recovery use the shared adapter interface, not
Boat-specific endpoints, so they also apply to Boxd's Linux guest. This is code
path coverage, not evidence of a successful live Boxd run. Repeat the staging
scenarios on Boxd when enabled, including preserved-process hibernation, cold
start, proxy wake, and unavailable diagnostic commands. A provider-wide outage
still requires independent evidence; one failing machine does not establish it.

Here is the shape of a bounded Boat command probe. Replace the two placeholders
with the identified sandbox and a private local key file; the key is not placed
in command arguments. Run it where those credentials are available:

```sh
node --input-type=module - bx_EXAMPLE /path/to/private-provider-key <<'JS'
import { readFileSync } from 'node:fs';
const [sandboxId, keyPath] = process.argv.slice(2);
const key = readFileSync(keyPath, 'utf8').trim();
const started = Date.now();
try {
  const response = await fetch(
    `https://boat.dev/api/v1/sandboxes/${encodeURIComponent(sandboxId)}/commands`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'uptime', timeoutSeconds: 5 }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const result = await response.json();
  console.log({ at: new Date().toISOString(), elapsedMs: Date.now() - started,
    status: response.status, exitCode: result.exitCode, timedOut: result.timedOut,
    code: result.code, requestId: result.requestId, stdout: result.stdout });
} catch (error) {
  console.log({ elapsedMs: Date.now() - started, error: error.name });
}
JS
```

Use the app-generated SSH alias from the Mac when available:

```sh
ssh -o BatchMode=yes -o ConnectTimeout=5 -o ConnectionAttempts=1 \
  -o ServerAliveInterval=5 -o ServerAliveCountMax=1 zuse-WORKSPACE_ID uptime
```

Also impose an outer execution timeout in the command tool. Do not bypass host
key verification or fabricate an SSH username/key/port. A managed SSH alias may
route through Zuse's gateway; its failure does not independently prove that the
provider VM is down. If the provider supplies a direct endpoint, check that path
separately with its documented credentials.

A TCP socket opening quickly but producing no SSH banner means the listener is
reachable, not that the guest is healthy. If both guest commands and SSH hang
while provider metadata works, investigate guest overload or provider host
problems before blaming desktop rendering. One unresponsive sandbox is not
proof of a provider-wide outage.

## 4. Once inside, inspect the host before restarting the runtime

Run inexpensive commands first through the working access path:

```sh
date -u
uptime
free -m
cat /proc/meminfo
cat /proc/pressure/memory
ps -eo pid,ppid,rss,comm --sort=-rss | head -25
df -h
ss -lntp
```

These are Linux guest commands. Missing PSI files or restricted socket/process
information are diagnostic limitations, not proof of a healthy system. Use
privileged read-only inspection only where authorized and available.

Interpret the numbers together:

- `MemAvailable` measures usable headroom better than `MemFree`; file cache is
  often reclaimable. High reported used RAM alone does not establish exhaustion.
- Swap nearly full plus high memory pressure and high load on a small CPU count
  is consistent with severe memory contention. Load average is not CPU percent.
- Compare a few samples spaced several seconds apart. A post-crash sample can
  look healthy because Linux already killed a large process.
- Start with executable names, RSS, PIDs, and parent PIDs. Follow the parent chain
  to distinguish build/test workers, Zuse, the coding agent, and provider services.
  Inspect selected command arguments privately only when needed and redact them
  before recording them. Do not dump every process's arguments or environment.

For suspected OOM, inspect the kernel's evidence around the incident time:

```sh
sudo -n journalctl -k --since '10 minutes ago' --no-pager -n 250
cat /proc/vmstat | rg '^oom_kill '
```

If the journal is unavailable, try a bounded `dmesg` read where permissions allow.
Look for the killed PID, command, cgroup/unit, memory table, and swap state. OOM
scores can explain why a provider service survived while Zuse was killed.
`oom_kill` is cumulative: compare within the same boot; a nonzero value alone
does not prove the current disconnect was caused by memory exhaustion. The
runtime memory baseline also fences the comparison by runtime generation.

Match the killed PID to its service and the agent's preceding work. For example,
correlate tool-call timestamps with test/type-check log start times and process
parents. Read only the relevant command metadata; avoid dumping the transcript.
Do not claim a memory leak just because several compiler workers used a lot of
memory. A leak requires growth observations under a comparable workload.

## 5. Inspect the actual runtime and agent

Discover the service instead of assuming it is named `zuse-runtime`:

```sh
systemctl list-units --all --type=service 'zuse-process-*'
```

Boat's tagged units are derived by `boxProcessUnit` in
`packages/sandbox-providers/src/box-process.ts`: the user and process tag are
hex-encoded. In a prior incident, the `zuse` / `zuse-runtime` pair was
`zuse-process-7a757365-7a7573652d72756e74696d65.service`. Confirm the current unit;
`systemctl status zuse-runtime` returning inactive can simply mean the name is
wrong. E2B uses a different provider process implementation.

For the discovered unit, inspect selected properties:

```sh
systemctl show ACTUAL_UNIT --property=MainPID,ActiveState,SubState,Result,NRestarts,ExecMainStatus,MemoryCurrent
sudo -n journalctl -u ACTUAL_UNIT --since '10 minutes ago' --no-pager -n 120
```

Inspect the recent tail of `/var/lib/zuse/workspace/runtime.log`, the bootstrap
failure marker, credentials-ready marker, listening runtime port, and selected
non-secret launch settings. Restrict collected logs and redact before sharing.
Record the installed runtime version and the signed channel it came from; merged
code and the binary inside an old sandbox may differ.

Follow the chain rather than stopping at a running Node process:

- Did enrollment and credential preparation finish?
- Did the runtime connect to the gateway with the current generation?
- Was the original queued command leased, accepted, and acknowledged?
- Did the provider agent start, produce output, or exit?
- Did tool results reach durable storage and then the client?

A healthy gateway HTTP response is not proof of a working authenticated
WebSocket. A live runtime is not proof the agent is doing useful work. Agent
output in storage with a stale desktop points toward event delivery/projection;
no agent progress in the guest points elsewhere.

If outbound networking or authentication is suspect, compare the same bounded,
read-only request as the setup user and the runtime user. A root request working
while `zuse` times out can expose a user-specific network policy. A 401/403 is a
server response, unlike a connection timeout. Inspect the effective policy and
image version; do not reinstall historical firewall rules or remove protections
blindly to make one probe pass.

## 6. Verify data before any repair

Follow [runtime data recovery](runtime-data-recovery.md) for candidate paths,
read-only SQLite inspection, expected chat/session IDs, integrity checks, WAL
handling, backup, and migration rules. Do not create a new database because a
known path is missing, or choose the largest database as the authority.

If the guest is unreachable, provider snapshots can supply older evidence. Boat's
snapshot file API can read a runtime log from a completed snapshot without
contacting the guest. Confirm snapshot time, inspect its tree for the actual
path, then fetch only the needed file. A snapshot from before the failure cannot
show what happened afterward and is not the current disk. Record that limitation.

Do not interpret an accepted stop request as a completed stop. Record the
provider's subsequent state and snapshot completion. A refused archive/stop may
be protecting unsaved changes; force-stop can discard work. Do not force it or
recreate the sandbox to hide a stuck state.

## 7. State a diagnosis with evidence and make one targeted change

Keep a short decision table in the incident note:

| Evidence | Next step |
| --- | --- |
| API denies access before reaching the guest | Inspect account/auth/billing error and deployment configuration. |
| Provider reports no capacity | Preserve the disk and report capacity; a larger paid size needs user approval. |
| Commands and SSH stall, kernel shows OOM | Identify workload memory, wait for headroom, use bounded runtime recovery. |
| Guest responds, runtime absent or exited | Inspect exit/logs, credentials, bootstrap version, and service ownership. |
| Runtime connects but no command acknowledgement | Inspect generation fencing, mailbox lease, and idempotency state. |
| Agent progresses but UI is stale | Compare durable events, gateway delivery, and client projection/version. |
| Stop refuses because snapshot save failed | Preserve data and collect provider request/snapshot evidence. |

Separate confirmed facts, likely explanations, and unknowns. Restore service
through the existing lifecycle/recovery mechanism where possible; coordinate
with its lease so manual work does not race a second writer. Never resend a
prompt just because its acknowledgement is uncertain, kill unrelated processes,
replace account credentials, or silently upgrade compute.

For a code fix, reproduce the specific failure with a controlled test, change the
shared owner of that behavior, add a regression assertion, and follow the
[testing runbook](memory-pressure-testing.md). Repairing one running guest and
preventing the next occurrence are separate outcomes. Record both.

## 8. Verify the user's original workflow, then report

Before saying "fixed", verify:

1. Same sandbox/disk, chat, and session where preservation is expected.
2. Current runtime generation is online; no repeated boot/enrollment loop.
3. Existing queued command is accepted exactly once; uncertain prior execution
   was not blindly replayed.
4. New agent/tool output appears and reaches the user's UI; Stop works while the
   agent is active and clears when it ends.
5. Reconnect and a later normal pause/resume work; old error notices clear.

If the UI is only accessible on the Mac, use the bridge or ask for one targeted
user check. Do not claim visual success from API logs alone. Record unresolved
parts explicitly, together with commit/PR, API deployment, runtime version, and
desktop release status. Remove temporary diagnostic services, sandboxes, and
credential copies created for the investigation when no longer needed.

## Worked example: Small Boat machine stopped responding

In the investigated incident, provider metadata was reachable, guest commands
initially timed out, and SSH TCP connected but did not produce a banner. Once
command execution recovered, kernel logs showed memory exhaustion and the Zuse
runtime PID being killed. Post-crash free memory alone would have missed this.

The agent's tool history showed two test suites and a Turbo type-check run
starting within about two seconds. The OOM process table showed roughly 2.3 GiB
across six Node workers, 1.5 GiB for Boat's agent, 0.6 GiB for Zuse, and 0.4 GiB
for the provider filesystem process, counting resident memory plus swap where
present. Other processes added to the load on a 4 GiB RAM / 2 GiB swap machine.

That supports excessive concurrent workload plus provider overhead as the
explanation; it does not establish a provider-wide outage or a memory leak.
Recovery verification checked the original SQLite data and session, the API's
online state, acceptance of the queued message, and subsequent tool results.
The follow-up product changes add pressure reporting and bounded recovery;
they do not limit the agent's build/test concurrency by themselves.
