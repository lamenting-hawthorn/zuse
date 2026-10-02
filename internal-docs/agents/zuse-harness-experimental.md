# Zuse experimental harness implementation status

Zuse is registered as an opt-in experimental coding provider, with ChatGPT and SuperGrok connection settings and the native engine connected to the existing chat lifecycle. This is not a completed v1 release. Existing harnesses continue to use their existing authentication. Do not advertise the release acceptance criteria as passed.

## Implemented modules

- `packages/agents/src/harness/model.ts` uses Vercel AI SDK (`ai`, `@ai-sdk/openai`, and `@ai-sdk/xai`) for public Responses streaming. It disables SDK retries, translates stable instructions through AI SDK 7's `instructions` option, namespaces local function definitions, supplies a connection/model/root cache key, and rejects unexpected subscription-route request fields. Tools have no SDK `execute` callback. Disconnected, incomplete, and failed streams cannot produce executable model steps. Error messages exclude raw HTTP bodies and tokens.
- `engine.ts` owns an injectable execution loop. It records completed model history before tool execution, records tool intent before calling the host, and records results before the next model request. A recovered uncertain tool receipt pauses for inspection. Request budgets, interruption, child capacity/depth limits, queue-only messages, follow-up wakeups, and final root synthesis are implemented here. Child histories use separate append-only arrays sharing inherited message objects.
- `state.ts` validates checkpoint structure and graph relationships. `prompt.ts` retains compaction summaries and covered-history boundaries. Compaction targets 50% after reaching the model’s auto-compaction limit (capped at 90% of its context window), or 90% when no limit is supplied, using the account catalog’s reported context window and falling back to 32K only when metadata is absent. The provider uses the smallest advertised window among eligible failover connections (unknown limits contribute the fallback). Inventory cache v3 preserves context, compaction-limit, and usable-window metadata rather than reusing older entries. It budgets retained exchanges before summarizing, makes at most two summary requests, and accepts useful reductions below the configured trigger when the 50% target is missed. Failed or cancelled attempts preserve the original history and checkpoint. Root progress and estimated context usage feed the existing composer; terminal failures stop the progress indicator. Encoded image bytes are excluded from text estimates, with a conservative per-image reserve. If the original task/instructions alone cannot fit, execution pauses with a focused-follow-up action.
- `account-broker.ts` maintains shared connection health and root affinity. Only a confirmed subscription usage-limit error cycles to another eligible account. Model and reasoning settings remain unchanged. Policy errors stop; temporary service failures have bounded retries. Portable history strips account-bound provider metadata.
- `cache.ts` provides deterministic serialization, opaque cache identities, and a bounded 64 MiB / 4,096-entry LRU for ephemeral content. Shared server SWR caches now have invalidation generations, independent loader ownership, deduplicated construction, per-key disposal, and asynchronous versioned persistence. The shared resource pool supports retiring individual keys while active leases finish.
- `apps/server/src/harness/chatgpt-oauth.ts` implements dynamic public-client registration, PKCE/state/nonce verification, loopback callbacks, JWKS discovery, identity verification, separate registrations, reconnect, rename, preferred selection, refresh, and disconnect. Metadata excludes access, refresh, and ID tokens. Granted scopes determine whether inference is authorized. Remote revocation status is returned separately from local disconnection.
- `vault.ts` adapts the existing credential service. Refreshes are serialized with the shared OS-backed process lock. The credential vault itself now rereads current disk contents and serializes cross-process mutations, preventing one runtime from overwriting another's credentials.
- `journal.ts` persists authoritative snapshots to the additive `0061_harness_executions` table in the existing runtime database. Revision checks reject stale writers. It does not initialize another conversation database or relocate runtime data.

## Native tools and background execution

`apps/server/src/harness/native-runtime.ts` now exposes `createNativeHarness`. It composes the engine with native tools, a per-root exclusive process lease, an injected model transport, and injected authoritative journal methods. The server provider adapter composes it with the existing chat lifecycle, SQLite journal, account broker, permissions, questions, plans, attachments, skill discovery, and bundled ripgrep.

Available tools:

- `read_file`, `read_image`, `list_directory`, `glob`, and `grep`.
- `write_file`, `edit_file`, and `multi_edit`. Replacements require the current SHA-256. Ambiguous literal matches fail unless `replace_all` is explicit. Multi-edit validates every replacement before committing one file. Writers share cross-process locks; new files use exclusive atomic creation, replacements use atomic rename, and existing permission bits are retained. Reads are fresh, not memoized. External writers do not participate in the lock, so the final hash recheck detects changes but cannot provide filesystem-wide compare-and-swap against arbitrary external edits.
- `exec_command`, `write_stdin`, `process_output`, `wait_process`, `list_processes`, and `stop_process`.
- `update_plan` and `request_user_input` are advertised only when the corresponding host callback is supplied.

Every invocation evaluates the existing permission policy. Native file paths must resolve inside the checkout; shell permissions authorize ordinary host shell access and are not an OS sandbox. Text/image reads are capped at 2 MiB. Large text results are saved as local artifacts; image results are persisted as multimodal tool receipts and passed through the AI SDK Responses adapter. Native edits and reads share the same schema definitions advertised to the model.

Commands run under Bash with pipe input, not a PTY. The server returns a process ID after the requested yield interval; callers should leave long-running commands in the foreground inside that managed process rather than adding shell `&`. Process output has byte cursors and local logs, capped at 64 MiB per command; exceeding the cap terminates the producer. Defaults allow eight running processes per root and retain at most 128 inactive/active process entries in memory, while durable artifacts remain on disk. Readiness notifications match a literal string across output chunks. Completion and readiness events have stable IDs, an on-disk outbox, and durable inbox deduplication. Unacknowledged notices survive in-memory eviction and replay on restart.

Process notices go only to the agent conversation. A completed root resumes synthesis when a notice arrives, using its existing request budget. Stop cancels descendant process groups even when their agent is idle, and prevents automatic wakeup. The existing process watchdog kills commands when the server dies or its lease expires. Cold recovery marks prior running commands interrupted; Continue is required before inference resumes. Commands are never relaunched merely because the host restarted.

Search currently uses `rg` from PATH or an explicitly supplied `ripgrep` executable. Bundling/discovering ripgrep in clean packaged installations remains required. Process logs and receipts are recovery artifacts, not disposable caches. The runtime does not yet provide an artifact retention/cleanup UI.

## Model connection settings

Open **Settings → Agent providers → Zuse (Experimental)**. The compact connection list has an Add menu for ChatGPT and SuperGrok, with rename, preferred-account, reconnect, usage, and disconnect actions in each row's menu. New connections can use **This computer** or **Zuse account** storage when the account service is available. Equal emails never merge registrations. Visible controls use `h-7`; copy is localized across the seven supported languages and pseudo-locale.

ChatGPT uses public-client registration and a local loopback callback. SuperGrok uses native device authorization: copy the code, open the verification page, and wait for consent. No Grok CLI installation is required. The experimental default uses the public xAI client `b1a00492-073a-47ea-816f-4c329264a828`; `ZUSE_XAI_OAUTH_CLIENT_ID` can override it. A live request to xAI confirmed device-code issuance (HTTP 200), but no real account consent or inference was performed. This does not establish a Zuse-specific client registration or guarantee future availability of that public client.

`connections-service.ts` exposes metadata and management operations through the `modelConnections.*` RPC contracts in `packages/contracts/src/model-connections.ts`. Tokens and device secrets stay server-side. Device polling handles pending consent, slowdown, denial, expiry, and cancellation. ES256 identity verification checks issuer, audience, subject, and required timestamps. Reconnect preserves identity; authorization generations prevent stale reconnects from undoing disconnection. Token renewal preserves cache identity. The model adapter uses Vercel AI SDK's xAI Responses transport with `store: false`, streaming, and SDK retries disabled.

Local credentials use AES-256-GCM encrypted records in the existing runtime database's additive `0062_model_connections` migration, with the key retained in existing secure storage. AAD binds each envelope to its namespace and ID. Old harness vault records migrate lazily, with tombstones preventing resurrection after failed cleanup. Other CLI/provider credentials and database locations remain unchanged.

Account-scoped records use the account API's encrypted PostgreSQL store and a server-fenced lease to coordinate rotating refreshes across hosts. Desktop requests authenticate with the signed-in Zuse account; cloud requests use the existing rotating workspace runtime credential. The backend derives ownership from authentication, rejects browser-origin requests, and returns only metadata through renderer RPCs. Remote listing is batched. Account changes discard the previous service instance. There is no offline copy of shared rotating credentials.

Deployment requires account API migration `0029_model_connections.sql`, the updated API/runtime, and the existing cloud data encryption key configuration. These changes have not been deployed. Existing local registrations are not automatically uploaded, and existing cloud CLI authentication remains separate. Shared SuperGrok connections are supported by the new runtime path. Native hosted ChatGPT auth/inference remains blocked pending the applicable [hosted integration access](https://developers.openai.com/siwc/token-sharing-open-source); local ChatGPT registration is not hosted authorization.

Browser checks used test accounts and a fake device code to verify the list, Add menu, storage choice, device instructions, cancellation, and rename. All visible buttons measured 28px and no horizontal overflow was observed. Real consent, subscription/model eligibility, packaged callbacks, and multi-host rollout still need end-to-end verification.

References: [OpenAI sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [xAI discovery](https://auth.x.ai/.well-known/openid-configuration), [AI SDK xAI](https://ai-sdk.dev/providers/ai-sdk-providers/xai), and the inspected [Hermes device-auth implementation](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/auth_xai.py). These are protocol references; upstream application code is not imported.

## Chat integration and remaining release work

Enable **Settings → Agent providers → Zuse (Experimental)**, connect an account, and choose a Zuse model in the chat picker. The provider is bundled and does not depend on an installed agent CLI. Backend changes require restarting the development build. Model inventory comes from authorized connections; ChatGPT and SuperGrok IDs are namespaced to prevent credential misrouting. Reasoning settings follow the selected model. Plan mode is not advertised yet.

The adapter maps text, tool calls/results, questions, usage, child attribution, child summaries, account switches, interruption, and durable resume cursors into existing provider events. Background process notices are journaled and consumed during active execution or the next user message; autonomous app turn dispatch is not enabled. Disabling the experiment blocks new inference without deleting history.

Still required before full v1 acceptance:

1. Connect existing MCP/browser integrations and durable event acknowledgements; add an inspection/recovery UI for uncertain tool outcomes.
2. Finish instruction/skill/schema caches, explicit connection lifecycle invalidation, cache diagnostics, and unknown cache-usage presentation.
3. Verify real account consent/inference, subscription eligibility, refresh/revocation behavior, and packaged macOS/Linux callbacks and process cleanup.
4. Run the 20-task matched-model evaluation and measure warm startup overhead, memory, and live provider-reported caching.

Provider integration tests use actual native edits, Bash, SQLite persistence and permission callbacks with a simulated model transport. They cover selection eligibility, opt-in gating, inventory deduplication, interruption, disablement, resumed tool history, child questions, and nested completion. Browser verification exercises the real picker with test connection metadata, not a live subscription.

Refresh timing and returning-login behavior still need verification against real token responses. No real account was connected during implementation.

## Verification

Native tests exercise real file edits and Bash commands, stale/ambiguous edits, atomic multi-edit failure, symlink escapes, permission changes, image transport, bounded artifacts, stdin, cursor reads, process limits, timeouts, orphan cleanup, notice replay, automatic synthesis, Stop, and exclusive root ownership.

Focused tests cover fragmented Responses streams, late usage-limit errors, incomplete streams, request-field rejection, persisted tool ordering, uncertain/known tool recovery, child context isolation and cancellation, compaction cold resume, physical retry budgets, account affinity/failover, bounded LRU eviction, stale SWR publication, independent waiters, per-key resource retirement, OAuth callbacks and signed ID tokens, rotating refresh serialization, independent vault writers, journal revision conflicts, and populated-database upgrades.

Connection tests additionally exercise signed device-login tokens, rotating refreshes, denial/cancellation, stale reconnect fencing, encrypted SQLite migration, account isolation, PostgreSQL lease expiry and restart, ciphertext swapping rejection, browser-request rejection, and account deletion. The server unit suite plus local connection-database integration passed 601 tests across 92 files. PostgreSQL tests use a disposable local database, not a deployed account service.

Useful commands:

```sh
bun run --cwd packages/agents test:unit
bunx vitest run apps/server/test/unit/harness-native-tools.test.ts apps/server/test/unit/harness-processes.test.ts apps/server/test/unit/harness-native-runtime.test.ts apps/server/test/unit/process-group.test.ts apps/server/test/unit/device-command-broker.test.ts
bunx vitest run apps/server/test/unit/swr-cache.test.ts apps/server/test/unit/chatgpt-oauth.test.ts apps/server/test/unit/credentials-service.test.ts apps/server/test/unit/session-store.test.ts apps/server/test/integration/session-store.test.ts apps/server/test/integration/harness-journal.test.ts apps/server/test/integration/migration-0045-upgrade.test.ts
bun run check-types
```

## References and attribution

The implementation is Zuse-owned code. No upstream application source is imported or vendored. Architectural research used [Codex d420560](https://github.com/openai/codex/tree/d42056091aded7feb1d88ac7e83972108b2aa478) (Apache-2.0), especially child control, context inheritance, and recovery; and [OpenCode 2fa3363](https://github.com/anomalyco/opencode/tree/2fa3363c924c5c3e367b84a87ae478296a0ed59b) (MIT), especially execution-loop and compaction boundaries.

Protocol references: [registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), and [AI SDK OpenAI adapter](https://ai-sdk.dev/providers/ai-sdk-providers/openai).

## Benchmark status

Behavior tests are regression coverage, not model/harness quality scores. The matched-model 20-task evaluation has not been run, and there are no Zuse SWE-bench or Terminal-Bench results. Existing repository benchmarks cover other subsystems and do not establish harness performance.

For external evaluation, [Terminal-Bench](https://www.tbench.ai/) measures terminal task completion and [SWE-bench](https://www.swebench.com/SWE-bench/faq/) measures repository issue resolution. A Zuse adapter and isolated task runners are still needed. Compare Zuse and the existing Codex driver using the same model, reasoning setting, budgets, task snapshots, and cold/warm conditions; report failures, intervention counts, completion, latency, tokens, memory, and observed cache usage.

Context policy mirrors Codex ModelInfo: the auto-compaction threshold defaults to 90% of the raw window, model overrides may lower it, and usable input capacity defaults to 95% with model-specific percentage overrides. These are separate quantities; the composer reports usable capacity. Zuse still estimates token usage, so this is policy parity rather than identical compaction timing or tokenizer behavior.
