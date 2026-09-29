# Managed plugin marketplace verification plan

Status: requirements for future implementation, not passing-test claims. Existing infrastructure checks are listed separately. Applies to Settings → Plugins (Marketplace, Installed, Accounts), plugin detail/access dialogs, browser authorization return, composer approvals, local runtime and cloud runtime dispatch, and publisher release pipelines.

## Coverage map

```text
Discover and install
  catalog fetch/signature/cache/page/search     -> unit + service integration + UI
  signed-out browse -> sign-in -> return       -> browser/Electron E2E
  first-install tenant provision              -> API/store integration + real service
  double-submit / crash / orphan reconciliation -> fault injection
Connect and enable
  provider OAuth/key -> account selection      -> browser + provider test account
  per-project account binding                 -> two concurrent local/cloud sessions
  grant mint/refresh/revoke -> agent tool list -> real runtime integration + E2E
Execute
  supported/unsupported agent version          -> registry unit + real agent matrix
  read / per-subcall policy / approve / deny   -> real Executor + tool-service fixture
  restart / reconnect / expiry / cancel        -> service + runtime integration
  write succeeded but reply lost              -> effect recorder + dropped response
Maintain
  update diff / consent / rollback / drift    -> catalog/service/renderer integration
  disable/remove/disconnect with references   -> concurrent lifecycle E2E
  mode switch / account logout / deletion     -> grants + credentials + callbacks E2E
Operate and publish
  signing separation / tamper / egress        -> CI fixture/security tests
  restore / key rotation / kill switch        -> staging drills
  10x load / slow tenant / queue limits        -> measured isolated load run
```

## Required tests by ownership

Names below are proposed test locations following existing conventions. Implement with real file/database/service boundaries where mocking would conceal the bug; use deterministic clocks and controlled fixtures for expiry/concurrency. Never use personal production accounts in CI.

| Area / proposed tests | Happy path | Failure / adversarial / boundary assertion |
|---|---|---|
| `packages/contracts/test/unit/plugin-manifest.test.ts` | Version, auth requirements, transports, domains and permission groups decode | Invalid semver, duplicate IDs, unsafe URLs, oversized data, HTML/icon payload, missing fields and incompatible host rejected |
| Shared artifact validation tests | Approved immutable manifest/assets verified before import | Signature/digest tamper, wrong identity, archive traversal/symlink if archives used, decompression/size limits, redirect to private address rejected |
| `infra/api/test/unit/plugin-provisioning.test.ts` | One authenticated account gets one tenant operation | Missing identity, caller-supplied foreign account, same-key double click, concurrent first-use, deleted tenant tombstone |
| `infra/api/test/integration/plugin-provisioning.test.ts` | API/store/service become active after provisioning | Crash before remote write, after write/before ack, duplicate delivery, old retry after deletion, outage and rate limit; no orphan credentials |
| `infra/plugin-service/test/integration/tenant-isolation.test.ts` | Two users use independent same-provider accounts | Swap tenant/subject/install/connection/MCP-session/toolkit IDs; replay token from another tenant; all list/read/write/blob/approval surfaces remain isolated |
| `infra/api/test/unit/plugin-grants.test.ts` | Owner enables explicit actions on a registered runtime/project | Wrong owner, revoked/unlinked environment, stale generation, unsupported capability version, untrusted claims, invalid audience, expired grant, replayed proof |
| `infra/api/test/integration/plugin-authority.test.ts` | Interactive owner manages bindings/approvals; runtime renews approved subset | Execution key cannot widen scope/resources, choose another binding, approve its own write, create OAuth state or call management APIs |
| `infra/api/test/integration/plugin-projects.test.ts` | Owner registers local project UUID; moves preserve identity | Same Git remote in two projects grants nothing implicitly; worktree creation, deletion/recreation, foreign environment and relink invalidate stale context |
| `infra/plugin-service/test/integration/plugin-resources.test.ts` | Selected repository/field/team reads succeed | Same allowed action on unselected repository/customer field denied, including aliases, GraphQL/nested/batch calls; narrowed provider token matches consent |
| `apps/server/test/integration/managed-plugins.test.ts` | Local and cloud runtime exchange proof for temporary per-session access | No refresh tokens at agent boundary; simultaneous work/personal projects retain separate bindings; stale context cannot publish tool results into another session |
| `infra/plugin-service/test/integration/plugin-oauth.test.ts` | Browser consent returns to initiating install + project/account selection | Wrong logged-in user, wrong provider, expired/replayed state, open redirect, PKCE mismatch, cancellation, callback after deletion; no activation or secret leakage |
| `infra/plugin-service/test/integration/connection-refresh.test.ts` | Two replicas coalesce one refresh and reuse encrypted result | Crash during rotation, revoked secret, stale lease holder, encryption key mismatch; reconnect visible and no unbounded retry of old token |
| `infra/plugin-service/test/integration/plugin-policy.test.ts` | Allowed read and approved specific write dispatch once | Outer execute containing two writes checks each subcall; argument/account change invalidates approval; bypass via native tool address/admin tool denied |
| `infra/plugin-service/test/integration/plugin-approval.test.ts` | Durable pending item resumes from same/another owned client | Approve/deny races, expiry, restart, removed install, revoked grant, changed binding/version; no duplicate side effect |
| `infra/plugin-service/test/integration/plugin-mutations.test.ts` | Provider idempotency key makes retried supported mutation safe | Drop response after write; state outcome_unknown; no transparent retry when provider lacks idempotency; user gets inspect-before-retry |
| `apps/renderer/test/unit/plugin-marketplace.test.tsx` | Search/details/Add/Installed/Ready and account picker | Loading/empty/stale/offline/error/partial, rapid double click, environment/account switch, long translations, unavailable agent; only correct active context updates |
| `apps/renderer/test/unit/plugin-access.test.tsx` | Explicit project binding to Work account | Same installation Personal binding elsewhere unchanged; no active project prompts selection; global disable vs local disable clearly differ |
| `apps/renderer/test/unit/plugin-approval.test.tsx` | Provider/account/action/target/preview are accessible | Large/malicious content treated as data; countdown expires; keyboard approve/deny; focus restoration and screen-reader status |
| `infra/plugin-service/test/integration/plugin-update.test.ts` | Same-permission update stages then atomically activates | Widened action/domain/scope requires consent; compilation/import failure keeps last good; remote tool drift quarantined; old active execution pins version |
| `infra/plugin-service/test/integration/plugin-lifecycle.test.ts` | Disable then remove, retaining reusable connection | In-flight dispatch may finish but next call denied; concurrent update/remove serialized; disconnect lists affected plugins, removes all relevant grants |
| `infra/api/test/integration/plugin-account-deletion.test.ts` | Access fenced then external secrets/tenant/projections removed | Partial deletion retry, account identity removal ordering, delayed callback/job, restore from old backup, no resurrection |
| `infra/plugin-service/test/integration/plugin-egress.test.ts` | Reviewed service host and bounded outputs | IPv4/IPv6 private/link-local/metadata addresses, DNS rebinding, redirect chains, oversized specs/results, slow headers/body and timeout cancellation |
| `packages/agents/test/unit/shared-mcp.test.ts` + driver integration | Claude/Codex/ACP HTTP and stdio receive temporary endpoint | Secret absent from argv/logs; reconnect/session-close cleanup; errors visible; version-specific missing capabilities disable safely |
| Protected catalog CI fixtures | Approved publisher release promotes signed immutable version | PR job cannot access signing key; wrong publisher, mutated artifact or unsigned emergency change rejected; revoke/quarantine tested |
| Staging backup/restore + container smoke | Data/keys persist across restart and compatible upgrade | Older backup uses new grant epoch plus reconciliation against restore-independent consent ledger; active account with revoked binding cannot obtain a new grant; missing authoritative ledger requires fresh consent; key rotation/recovery; failed migration doesn't enable traffic; old/new clients coexist |

## Real-user workflow acceptance

1. Use a clean Zuse user, no Executor account, no preinstalled plugin and no pasted Executor URL/key. Browse GitHub Review, sign into Zuse if needed, connect GitHub, choose one test repository, enable in a local project, and ask Claude Code to summarize an actual PR.
2. Create a Codex cloud chat owned by the same Zuse account. Select the already-connected GitHub account and enable access without repeating service authentication. Verify a read, then an explicitly approved comment on a disposable PR. Verify denial does not create a comment.
3. Connect a second GitHub account. Run work and personal projects concurrently, one local and one cloud, with distinct bindings. Change/revoke one binding; the other retains its original account. Neither agent can discover/use the other's ungranted connection by naming its ID.
4. Close the desktop while a write awaits approval. Reopen and resume the same pending action with verified context; expire another pending action and show that approval cannot resurrect it.
5. Exercise Linear issue→implementation→approved update and Customer.io inspect→preview→approved supported change using verified test accounts. Missing provider app approval or unsupported API is a release blocker for that advertised package.
6. Expire credentials, disconnect network, restart service/runtime, and change the selected Zuse account during a connection attempt. Recovery never silently changes the account or replays a write.
7. Update to a version with added permission. Old permissions remain until explicit consent. Test an allowed tool against an unselected repository and disallowed customer attributes, including alternate identifiers and nested calls. Reject an update and keep the working version; remove it while another plugin shares its account; explain and preserve that account.
8. Disable plugins globally and in one workspace, log out/unlink a device, delete the Zuse account, and restore an old staging backup. New dispatch is denied according to the stated scope, including existing MCP sessions and approval resumes.

Run on packaged macOS and real cloud runtimes. Browser fixtures are useful but do not substitute for packaged credential storage, browser callbacks, deployed HTTPS, real runtime generation checks, or actual agent MCP behavior.

## Design and performance checks

- At 720×480, 1280px, both themes, pseudo-language and all seven locales: primary Add/Connect/Enable remains visible, details scroll, labels don't overlap, and visible controls remain h-7.
- Keyboard-only marketplace → detail → browser handoff → confirmation → approval → back. Focus returns predictably; statuses announced; no color-only state.
- Screen-readers distinguish Installed, Needs account, Not enabled here, Ready and Unverified agent. Accounts used by more than one plugin show affected consumers before disconnect.
- Cached catalog browsing works through outage; untrusted stale data cannot grant access. No connector health fan-out during chat startup.
- Measure proposed server p95 catalog <300ms, grant <500ms, warm startup overhead <200ms and dispatch authorization <100ms, excluding provider time. Record hardware/network/sample size and p99; targets are not assumed success.
- Run ten times expected concurrent tenant/session load with one deliberately stalled connector. Verify bounded memory/queues, fairness, cancellation and independent tenant progress.

## Existing check commands and gaps

Existing commands: `bun run check-types`, `bun run check:i18n`, `bun run --cwd apps/renderer test:unit`, `bun run --cwd apps/server test`, `bun run --cwd packages/agents test:unit`, `bun run --cwd apps/docs check-links`; run Biome on touched paths. Use the API package's declared test command and service/package-specific checks when introduced. Keep existing renderer bundle checks and standalone SDK starter validation.

Current BYO regression tests are in `apps/server/test/{unit,integration}/executor.test.ts`, `apps/renderer/test/unit/agent-plugins-pane.test.tsx`, `packages/agents/test/unit/shared-mcp.test.ts` and ACP tests. None validates managed OAuth, tenancy, publishing or automatic grants. Every row above is a required new or extended test before its implementation is called done.

Prompt/agent evaluation: this plan does not change the core system prompt or model selection. It adds tool definitions and Try it examples, so run a small task suite across Claude/Codex: intended read, correct account, unrelated request, denied write, malicious tool output, expired permission, unknown write outcome and clear user explanation. Real dispatch/authorization assertions are mandatory; LLM wording evaluations cannot replace them.

## Release checklist

- Pinned dependency/host/persistence feasibility passed; authenticated tenant isolation and per-subcall policy verified.
- First useful vertical slice demonstrated before broad catalog work; repeated use measured without collecting prompts.
- Signing, container registry, TLS, database, secret manager and provider OAuth apps actually provisioned.
- CI separates untrusted PR validation from protected publication; immutable artifacts and rollback image verified.
- Clean users can use every advertised official package on macOS + cloud with Claude/Codex; ACP transport variants pass.
- Key rotation, deletion, stale backup, kill switch and rollback rehearsed in staging.
- Public docs describe data flow, account/grant scopes, compatibility, self-host option and realistic limits; launch screenshots/demos come from the working build.
