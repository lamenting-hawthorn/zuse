# Cloud agent environment UX research

Checked 2026-10-02 against first-party documentation. Research only; no runtime changes.

## Devin

- Sessions start from a fresh copy of a prebuilt environment containing repositories, tools, and dependencies. Each organization has one active snapshot; session changes do not alter it. Configuration changes automatically produce a new snapshot. The default setup UX is to ask Devin to configure the repository, review its suggested blueprint, and approve the build. This hides manual image authoring, not snapshots themselves. [Environment setup](https://docs.devin.ai/onboard-devin/environment)
- Repositories are cloned during builds. Sessions pull current code; maintenance commands are supplied to the agent, not automatically executed, so it can refresh dependencies when needed. Blueprint saves, repository changes, manual requests, and roughly daily refreshes trigger builds. Thus “clone everything from scratch on every session” is not an accurate description of Devin's documented path. [Blueprints](https://docs.devin.ai/onboard-devin/environment/blueprints)

## Hoplite

Identity: the product at `hoplite.sh` (also reached through `usehoplite.com`) is operated by Carbon Copy Markets, Inc. It is distinct from Paxos's internal “Hoplites” coding agents; do not combine their architecture claims. [Hoplite about](https://www.usehoplite.com/about), [Paxos Hoplites](https://www.paxos.com/blog/meet-hoplites-the-coding-agent-behind-15-of-our-commits)

- Hoplite documents a separate cloud workspace per thread, cloned from the repository with the project's setup script and encrypted environment variables. Continuing a thread restores its workspace from a snapshot on the same branch. This supports repository-first onboarding plus durable session restoration, but does not establish whether every new thread performs a full network clone. [Multiplayer agent](https://hoplite.sh/product/multiplayer)
- The September 16, 2026 release makes prebuilds default for supported lockfiles, including dependency preparation and a warm preview. Existing opt-outs remain respected; other existing projects enable them after successful setup. Users can disable prebuilds per project. This is evidence for automatic acceleration behind project setup, rather than mandatory manual image management. [Changelog](https://hoplite.sh/changelog)

## Implications for Zuse — proposals, not competitor facts

- Make “connect repository → start workspace” the primary flow. Offer optional setup commands and infer safe defaults from repository metadata; keep image/provider details advanced.
- Separate a platform-managed base runtime, disposable dependency acceleration, and durable user-session recovery. A reusable build cache is not the only copy of a workspace's uncommitted work or database.
- A bounded, automatically managed prebuild cache could improve speed while allowing cold checkout/setup when no cache is available. A shared ten-snapshot ceiling should constrain acceleration capacity, not the number of repositories users may connect.
- Do not automatically evict session recovery snapshots under the same policy as reproducible build caches. Verify provider semantics, active references, recovery behavior, authorization isolation, billing evidence, and cold-start performance before implementation.

## Unknowns

These sources do not verify Boat's reported ten-snapshot cap, its scope, pricing, or which snapshot types count. They also do not establish Hoplite's backing provider, image limits, exact clone/cache implementation, retention policy, or cache-miss behavior. Devin's single active organization snapshot is not evidence of a matching provider quota. The recommendations above require a separate Zuse/provider feasibility check.
