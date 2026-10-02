# Experimental harness review remediation

The existing work was checkpointed in `e9b75023a` before remediation. Database paths, saved transcripts, execution journals, and provider credentials are preserved.

## Changes

- Legacy supervised commands retain their previous descendant lifecycle and empty `SHELL` fallback. Harness-owned commands explicitly opt into descendant cleanup.
- Sign-in and update streams use one cancellable owner, including client-acquisition fencing and terminal timers. Provider sign-in is scoped by computer/provider and refreshes provider availability and models without mounted Settings views. Updates can be cancelled from their progress control.
- Model connection attempts are retained by account/computer, independent of view mounting or experimental-control visibility. Pending dialog details survive navigation. Idle, unobserved controllers expire after a minute. Account credentials remain bound to their original account; server-side account changes still fence access and report failure rather than writing credentials to another account.
- Connection names no longer default to email. Existing/custom email names are blurred; rename starts empty for those names, and account-switch transcript notices use the product name. Storage uses a compact select, controls use `h-7`, and provider details use the normal compact indent.
- Provider names, tool-name normalization, clipboard handling, device-code rows, browser opening, error formatting, and RPC-derived connection types share existing implementations. ChatGPT/SuperGrok product names intentionally differ from Codex/Grok harness names.
- Static provider traits are centralized in contracts: plan mode, app tools, CLI backing, default enablement, credential source, native subagent default, authoritative inventory, and skill folders. Driver/protocol dispatch remains with its owning implementation.
- OAuth registration types and errors have neutral names. Both providers share pending-attempt ownership, refresh locking, expiry decisions, atomic rotation, disconnect/revocation lifecycle, and bounded form requests. Provider-specific token validation and identity verification remain separate. PKCE is shared with WorkOS.
- Shared helpers cover image signatures, path containment, canonical serialization, private atomic JSON writes, and process-lock scope. Existing v1 chat-creation fingerprint serialization is explicitly preserved so durable command retries remain compatible.
- Vault reads reuse decrypted contents only while inode, size, modification and change timestamps still match. Writers reread under an OS-backed lock. Envelope validation is delegated to secure storage. Lock failures retain causes and distinguish timeouts.
- Prompt estimates are looked up by immutable message identity before serialization, including inherited messages. Only estimates are retained under the bounded LRU; duplicate serialized prompt text is not retained. Account-broker dead methods were removed.
- Invalid storage commands return 400; JSON responses use the shared helper with `no-store`. Startup validation uses typed failures with actionable reasons. Composer compaction lookup is memoized. Unused translations were removed, shared connection keys renamed, and new statuses localized, including mobile compaction.

## Deliberate exceptions to review suggestions

- `SharedResourcePool.remove` remains a tested public primitive. Per-key resource disposal is an explicit requirement of the accepted cache design; manufacturing an unrelated call site or deleting it would weaken that contract.
- Native checkout edits retain their specialized atomic edit path: no-clobber creation, file mode preservation, fsync, stale-content checks, and symlink checks differ from private JSON metadata writes.
- The requested checkpoint already contains the skill-file formatting change. Its history is preserved rather than rewriting that checkpoint or restoring formatting that violates Biome. The remediation diff adds only the shared skill-folder reference to those files; inspect the original implementation with `git diff -w origin/main...e9b75023a -- apps/server/src/skill/layers`.

## Verification

Regression coverage includes OAuth refresh races and revocation, credential rotation across independent readers, native process cleanup and legacy descendant survival, interrupted stream acquisition, off-screen completion, prompt estimate reuse across forks, actionable startup errors, and malformed storage commands. Check logs under `.context/review-*.log` for this workspace's runs.

Real-account browser authorization and packaged macOS UI testing require a live user session and were not performed by these automated tests. The database-backed cloud integration test requires `ZUSE_TEST_DATABASE_URL`; the storage command validation tests run without PostgreSQL.

## Restricted rollout

The experimental harness is now restricted to the authenticated Zuse account `mrfranklenstein@gmail.com` (case-insensitive). The shared rollout flag is in `packages/utils/src/feature-access.ts`. Settings and model pickers hide the feature for other accounts, and the runtime independently denies connection operations, credentials, and new/resumed harness starts. Saved enablement does not bypass this gate. Existing transcripts and credentials are retained. Runtimes without an authenticated Zuse account fail closed.
