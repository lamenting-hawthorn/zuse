# Cloud memory pressure and recovery

The selected desktop cloud chat subscribes to the existing resource stream only
while a turn is active and its runtime is already connected. It never wakes a
paused machine for monitoring. Older runtimes omit the optional pressure field.

Linux readings use MemAvailable, which includes reclaimable file cache. The UI
warns after three consecutive low-headroom samples (normally ten seconds from
the first sample), below both 10% of RAM and 512 MiB. It clears on a healthy
sample. This indicates pressure, not proof the agent caused it: provider services
and other processes share the machine.

On cloud runtime startup, a best-effort atomic file records the kernel boot ID,
runtime generation, and oom_kill counter. During recovery of an unavailable
runtime on a running sandbox, the API reads this baseline and current Linux
counters through the provider adapter. A counter increase in the same boot and
generation confirms an OOM kill on the machine, not necessarily of Zuse itself.
Old templates without a baseline and failed/timed-out reads cannot confirm OOM.
The diagnostic reads run concurrently with a two-second timeout.

Recovery defers launching the runtime while memory is low. It rechecks at most
every 30 seconds and stops after five minutes of persistent pressure. Confirmed
OOM recovery is limited to three launches per ten-minute episode. An explicit
retry after memory recovery failure begins a new episode on the same sandbox;
it must not pick a newer template and discard the retained disk. Authenticated
runtime readiness clears the normal lifecycle status. Existing fencing and
mailbox delivery remain responsible for resuming work without duplicate prompts.

No processes are killed by this detector, no paid size is changed, and no database
is initialized or migrated. This is recovery and reporting, not a resource quota.
A fully unresponsive guest may be unable to provide memory evidence; normal
bounded connection failure remains the fallback. A runtime that reconnects on
its own before the diagnostic probe may not expose a past OOM to the user.

Roll out API and cloud runtime support, then the desktop UI. Verify Boat and E2B
on staging before production. Use controlled failure injection for tests; do not
exhaust memory on a user's active production sandbox.

See [the testing and rollout runbook](memory-pressure-testing.md) for executable
checks, staging scenarios, evidence requirements, and what remains unverified.
