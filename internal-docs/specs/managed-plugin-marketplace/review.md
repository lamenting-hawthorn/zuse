# Marketplace plan review

The user already confirmed the product premise in the conversation: Zuse-owned marketplace and invisible automatic Executor provisioning across local/cloud agents. This is planning, not authorization to deploy or publish the new service. Existing stack rebase/push remains authorized independently. Review artifacts stay in this workspace, not a long-term file-backed memory system.

## Strategy review

Primary review plus independent strategy agent. The separate Codex CLI review was attempted but returned HTTP 401 (no configured API authentication); no output or cross-model consensus is claimed. A distinct Claude model is not exposed by the current agent tool. Subsequent phases use an independent available agent, with this limitation recorded.

Premises: useful service-backed tools belong to the user's identity, not one coding CLI; Zuse owns the normal onboarding; accounts require isolation and explicit consent; Executor is replaceable infrastructure. The first three are user-confirmed. The last is an architectural recommendation, supported by the SDK/host composition research and the absence of a verified hosted partner provisioning contract.

Alternatives considered: existing BYO mode, hosted partner provisioning, and owned SDK host. BYO fails the requested normal UX. Hosted provisioning remains unverified. Owned hosting is recommended but its persistence/auth/policy compatibility must pass M0 before committing to an operational design. Do not describe a stock single-organization container as multi-tenant SaaS.

Current state → plan → long-term: manual Executor configuration + agent bridge → managed identity/catalog/connection/permissions + repeatable useful jobs → reviewed publishers and explicit team tenancy. The plan avoids rewriting agent drivers or introducing separate provider OAuth per CLI. The minimum full product needs identity, credentials, grants, policy and lifecycle; omitting those would be a demo. A private one-plugin vertical slice tests product value before expanding breadth.

Independent findings, all incorporated:
1. High: global installation account binding conflicts with simultaneous work/personal projects. Move bindings to project/environment enablements and bind grant/approval revisions.
2. Medium: useful product validation was too late. Add a one-plugin private vertical slice after feasibility, before broad connector/publisher expansion.
3. Medium: “MCP-compatible” is insufficient. Add a centralized tested agent/version behavior matrix and visible Supported/Update required/Unverified states.
4. Medium: first-tool success alone measures demos. Add aggregate second-session/repeat-use and reconnect/approval abandonment measures.

### Strategy section findings

Architecture: retain Zuse API as account authority and keep upstream host dependencies in one service adapter. Cross-service identity and per-tool authorization are new boundaries, with phase-0 proofs and negative tenancy tests required. The simple unique-URL proposal was rejected because a URL is not an authorization boundary.

Error/rescue: the plan names setup, callback, credential refresh, service outage, revoked access, ambiguous writes, malicious imports and deletion/restore errors. Every case has an explicit retry/fail-closed/inspect result and a user-visible recovery. No automatic replay of uncertain writes.

Security: new OAuth endpoints, provider egress, publishing and per-session credentials expand the attack surface. Tenant/subject binding, single-use callback state, reviewed egress, signed immutable manifests, per-tool policy and argument-bound approvals address the proposed risks. A review/signature cannot guarantee the behavior of a mutable remote MCP service, so drift is explicit.

Data flow: nil identity produces sign-in, empty catalog produces an empty state, transient setup persists a retryable operation, and successful setup activates only after external provisioning is reconciled. Double-clicks, callbacks after deletion and concurrent refresh require persistence-backed idempotency. Per-project bindings prevent accidental cross-project account selection.

Code quality: reuse registered environments, proof-bound auth, existing store/outbox patterns and shared agent MCP helpers. Do not implement a second general auth provider or a new broad job framework. Contract packages remain schema-only.

Testing: current BYO tests do not count as managed-feature coverage. A companion matrix will name new tests for every UX/identity/lifecycle boundary; live provider and packaged macOS checks remain release gates. No paid tools were called for this review.

Performance: avoid live catalog/health fan-out on chat start; cache public catalog separately from tenant projections, paginate and bound dispatch. Live revocation checks are deliberate correctness costs and need measured latency. Target values are proposals, not benchmark results.

Observability: use correlation IDs and aggregate funnel/repeat-use metrics, not prompts or raw tool arguments. Operational alerts cover stuck provisioning, failed refresh, revoked dispatch and deletion lag. Outcome-unknown writes are a first-class support state.

Deployment: additive control-plane plus service migrations precede enablement, with a staff flag and clean-account proof. Preserve BYO profiles, all chat data and cloud data directories. Key provisioning, provider app registration, service backup/restore and runtime compatibility are release gates.

Trajectory: personal tenancy is honest about the current Zuse account model; team sharing is an explicit follow-up. Declarative tool packages deliver cross-agent utility while native hooks/scripts require another contract. The publisher review pipeline is specified so “ecosystem” does not mean an uneditable hardcoded list.

Design handoff: specify account-wide installation vs project enablement visibly, distinguish installed/connected/ready, and preserve context through browser auth. Keep normal product copy free of Executor IDs and infrastructure terms. Desktop density is fixed by DESIGN.md, not a new visual style.

| Strategy dimension | Primary | Independent agent | Separate CLI |
|---|---|---|---|
| Premises / problem | Accepted user direction | No blocking objection | Unavailable (401) |
| Scope / alternatives | Owned host with feasibility gate | Earlier useful vertical slice required; added | Unavailable |
| Account model | Per-project grants | Global binding conflict; fixed | Unavailable |
| Six-month trajectory | Publishers/teams phased | Compatibility and repeat-use gaps; fixed | Unavailable |

Strategy phase complete with 4 incorporated findings. No cross-model consensus claimed. No change to the user-confirmed direction; defaults/recommendations remain reviewable in the plan.

## Design review

Primary review and independent product-design agent inspected the plan against DESIGN.md. Existing settings geometry, h-7 controls, coarse-pointer hit expansion, neutral surfaces, accessible state text and the 720×480 minimum are retained. No new visual design system or generated mockup is required; the wireflow is the implementation reference and rendered QA remains a release gate. The separate CLI voice is unavailable due to the authentication failure above; no claimed Claude/Codex consensus.

All five independent findings were incorporated: explicit project+environment targets with stable in-flight context; approval inbox/conversation recovery and non-resumable handling; primary usability status distinct from Installed; detailed Accounts management with affected project bindings; durable browser handoff recovery and post-return access confirmation.

| Design pass | Before → after specification score | Resolution |
|---|---|---|
| Information architecture | 7 → 9 | Marketplace/Installed/Accounts plus precise context and approval entry point |
| Interaction states | 7 → 9 | Status precedence, stale/partial/error, orphaned approvals and ambiguous writes |
| User journey | 7 → 9 | Discover → connect → verify account/target → enable → explicit composer send; recover browser handoff |
| Generic/sloppy UI risk | 8 → 9 | Real workflows and dense native rows; no new dashboard or infrastructure IDs |
| Design-system alignment | 9 → 9 | Existing DESIGN.md primitives/density/tokens retained |
| Responsive/accessibility | 8 → 9 | Minimum window, keyboard/focus, browser return, localized labels and coarse-pointer hit targets |
| Unresolved decisions | 6 → 9 | Account-wide versus local access, replacement scope, approval return, and Try it destination specified |

Scores describe plan completeness, not validated pixels. Packaged rendering, real browser auth, localization overflow and assistive-technology checks remain required. No user-confirmed scope was removed; mobile management stays an explicit subsequent release.

Design phase complete. Engineering review receives the revised account-binding, compatibility, early-validation and precise UX contracts.

## Engineering review

Primary code mapping read existing Zuse API identity/proof/enrollment, account deletion, cloud GitHub broker, scoped Executor host composition, renderer settings, shared MCP drivers and schema/migration conventions. The independent engineering agent inspected Zuse source; its tool environment could not access the reference checkout, so upstream feasibility remains independently unverified. M0 explicitly gates published exports, production persistence, auth injection, durable state and per-tool enforcement. No unsupported white-label hosted API is assumed.

Independent findings, all incorporated:
1. High: action groups do not enforce selected repositories/customer fields. Add versioned resource constraints, connector normalization/dispatch enforcement, provider credential narrowing, and bypass tests. Existing GitHub installation tokens are not assumed narrowed.
2. High: runtime proof is not interactive consent. Add endpoint/action credential authority table; runtime cannot approve, rebind, connect accounts or widen grants, only renew already-approved equal/narrower rights.
3. High: invalidating old grants after restore does not prevent new grants minted from stale consent. Reconcile with a restore-independent current ledger; block issuance/use or require fresh consent if authority is lost. Test still-active account + revoked binding + new grant.
4. Medium: local projects have no implied cloud registry equivalent. Specify opaque environment-scoped project IDs, owner-authorized registration, move/worktree/delete/relink semantics and explicit local/cloud association.

Primary additional constraints: verify published SDK exports outside the reference repo; forbid direct network/admin host bindings that bypass dispatcher policies; acknowledge the unavoidable refresh-token crash interval and require reconnect when recovery is impossible.

Architecture: one control plane and one isolated execution service, not a new per-agent integration platform. The dependency graph, identity flow, proposed grants and boundary credential table are in the main plan. The SDK may not supply the required deployment semantics out of the box; M0 is a stop/go feasibility gate, not a claim those seams work today.

Code quality: extend existing auth/store/outbox/registry patterns and use one managed/BYO resolution seam. Keep behavior out of contracts, avoid reusing desktop unsandboxed extensions for service plugins, and avoid duplicate provider credentials/authorities. Proposed filenames are ownership guidance; M0/M1 freeze published contracts before parallel work.

Tests: companion test plan maps discovery, sign-in, provisioning, callback, refresh, policy, approval, uncertain writes, catalog signing/update, deletion, restore, egress, two-account binding, local project identity and authority separation. Existing tests cover BYO and transport only; new managed paths remain explicit implementation gaps. The high-risk tests use real process/database/service boundaries, plus macOS/cloud/provider E2E, not exclusively mocks. Tool-definition task checks are required without changing core system prompts.

Performance: paginated projections and a cached public catalog avoid N+1 provider health calls. Bound per-tenant/session queues and imported/output data, exercise a noisy neighbor, and measure grant/dispatch overhead with live authorization checks. Targets are recorded as unmeasured and rollout must not trade revocation correctness for a cache shortcut.

Distribution/rollout: immutable container/SDK/catalog artifacts, protected signing, registered OAuth callbacks, additive independent database migrations, service/API/runtime/UI deployment order, staff slice and kill switches. Rollback retains data and authoritative revocations. Runtime data paths and conversation state remain untouched; real release credentials and platform verification are not available merely because this plan exists.

| Engineering dimension | Primary | Independent agent | Separate CLI |
|---|---|---|---|
| Architecture | Owned host; feasibility gate | Local registry and authority scopes clarified | Unavailable (401) |
| Tests | Full future-path matrix | Resource/authority/restore/project negative tests added | Unavailable |
| Performance | Bounded queues, no startup fan-out | No additional blocking issue | Unavailable |
| Security | Per-session/per-tool checks | Three high-severity contract gaps corrected | Unavailable |
| Failure paths | Durable recovery, ambiguous writes explicit | Restore/new-grant gap corrected | Unavailable |
| Deployment | Staged rollout, immutable artifacts | Upstream feasibility not independently verified | Unavailable |

## Cross-phase themes and completion

- Account versus project scope appeared independently in strategy, design and engineering. Addressed by account-wide package installation plus explicit project/environment account bindings, named UI targets and registered opaque identities.
- “Installed” must not imply “authorized” or “works with any agent.” Strategy requested a compatibility contract, design a usability status hierarchy, and engineering a distinct runtime authority. All are in the plan.
- Recovery must preserve authority, not just records. Design added orphaned-approval handling; engineering added revocation reconciliation across restore. Both have explicit negative tests.

Review status: **DONE_WITH_CONCERNS**. Planning and independent strategy/design/engineering reviews are complete; all reported plan gaps have concrete decisions/test requirements. Independent CLI review was unavailable; no cross-model certification is claimed. Feasibility, deployed credentials, real provider workflows, packaged macOS and live cloud managed-flow checks remain future release blockers, not completed work.

Implementation choices surfaced for user review: managed personal accounts first; one first-party vertical slice before three launch packages; declarative tools first; reviewed submissions before delegated publisher credentials; teams/native hooks/mobile management later. These retain the user-confirmed Zuse-owned ecosystem direction. The main plan records alternatives, rationale and follow-ups. No new feature implementation or managed-service deployment was authorized/performed by this planning turn.
