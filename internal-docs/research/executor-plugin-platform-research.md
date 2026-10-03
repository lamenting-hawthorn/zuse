# Executor as a Zuse plugin backend

Research date: 2026-10-01. Research only; no integration deployed or provider OAuth flow exercised.

## Recommendation

Updated scope: prioritize existing remote MCP endpoints with automatic client
registration. Manual OAuth-app creation per service is not the default, and a
managed connector vendor is outside the user's requested approach. The initial
research overemphasized first-party API OAuth apps; those are an optional path for
services that need them, not a prerequisite for connecting remote MCPs.

**Use Executor as a candidate embedded engine behind a Zuse-owned service, not as an assumed turnkey white-label SaaS.** Its current gateway SDK supplies the useful primitives: a tenant-shared integration catalog, personal connections, first-party OAuth applications, policies, token handling, and MCP exposure. Zuse should own user identity, the curated plugin catalog, connection UX, authorization, the public domain, and runtime grants. Pin the engine version behind a narrow adapter. Qualify the engine through a live spike before committing to it.

This is an architectural inference from the inspected code, not an advertised Executor white-label product. I did not find a documented OEM offering, external-user provisioning contract, supported embedded connection-session SDK, or end-user-based commercial pricing in the public material examined.

## Version distinction that affects the decision

The public gateway site and current GitHub `main` describe integrations/connections and an embeddable SDK. The separate `v2.executor.sh` **beta** describes providers/accounts/apps with different deployment and tenancy semantics. Do not combine their APIs into one design. [Gateway introduction](https://executor.sh/docs), [beta introduction](https://v2.executor.sh/docs).

Source inspection pinned to commit `98d606bd2b47b9dcc2c03a129a14b5134d9852c8` in [UsefulSoftwareCo/executor](https://github.com/UsefulSoftwareCo/executor/tree/98d606bd2b47b9dcc2c03a129a14b5134d9852c8). Source was cloned read-only to `/tmp/zuse-executor-research`. Some source comments call the gateway's internal schema “v2”; that does not mean it is the separately hosted beta product.

The beta owns accounts/apps at organization level, requires admin or owner to run MCP tools, and lists per-person account selection on a shared app as future work. These are **beta-specific** limitations, not evidence against current gateway SDK personal ownership. [Beta organizations](https://v2.executor.sh/docs/concepts/organizations-and-access), [beta accounts](https://v2.executor.sh/docs/concepts/providers-and-accounts).

## What current gateway source demonstrates

### Personal connections and identity

The SDK binds an executor to `{ tenant, subject }`. Storage policies constrain owned rows to the tenant plus either shared organization rows or the current subject's personal rows. Integrations are tenant-shared. A null subject is organization-only; a tenant-wide administrative read mode exists separately. This is a concrete foundation for a shared plugin catalog with each user's own accounts. [Owner policy](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/sdk/src/owner-policy.ts).

Cloud middleware resolves authenticated identity, verifies organization membership, then constructs a request-scoped executor. The host exposes a neutral `IdentityProvider` seam; its cloud implementation uses WorkOS. Zuse can supply its own verified identity through an analogous composition, but tenant/subject strings themselves do not authenticate a caller. Derive both from trusted Zuse session/runtime-grant validation, never user-supplied request fields. [Protected middleware](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/apps/cloud/src/api/protected.ts), [scoped executor](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/api/src/server/scoped-executor.ts).

Cloud API keys distinguish user-owned keys from organization-owned platform keys. Reusing one organization credential as every Zuse user's authority is therefore not a correct personal-connection design. [API key model](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/apps/cloud/src/auth/api-keys.ts).

### Catalog and one-click connection

The key automatic path is MCP auth discovery and dynamic client registration.
Executor discovers the authorization server, calls its advertised registration
endpoint, then performs the user's PKCE authorization flow. Its helper accepts
`clientMetadata` overrides for Zuse's name, URI and callbacks. No manual developer
app registration is needed when the server permits this flow. Client metadata
documents provide another protocol option; the source serves such documents, but
end-to-end negotiation with the selected server still needs qualification.
[Pinned discovery implementation](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/sdk/src/oauth-discovery.ts),
[MCP client registration](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

Linear explicitly documents remote MCP OAuth with dynamic client registration, so
it is a concrete initial target. Public MCPs can require no auth, while other
servers need tokens or preregistered clients. MCP does not universally remove auth;
it can remove manual setup through a standard connection flow.
[Linear MCP](https://linear.app/docs/mcp).

Executor's UI combines curated integration presets with `integrations.sh` search. The client calls `GET https://integrations.sh/api/search?q=...&limit=...` and resolves a selected domain through `/api/<domain>/surface`. Supported catalog types are MCP, OpenAPI, and GraphQL. Results contain endpoint/spec locators and sometimes authentication hints or spec patches. This is discovery metadata, not proof of maintained, approved, one-click OAuth support. [Registry client](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/react/src/lib/integrations-sh-catalog.ts).

The host supports `firstPartyOAuthClients`, including configured provider endpoints, client IDs/secrets, allowed scopes, integration matching, and provider-specific token formats. OAuth start returns either a connected result or an authorization URL and state. A personal connection can use a shared host OAuth client. This permits the intended UX with **Zuse-operated OAuth apps**, without asking users for endpoint URLs or app credentials. [Host configuration](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/api/src/server/scoped-executor.ts), [OAuth API schemas](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/api/src/oauth/api.ts).

Do not assume Executor's hosted OAuth registrations transfer to Zuse. Its own cloud source withholds the Slack MCP client because of Marketplace approval and gates Google listing through a review rollout. A provider's existence in the catalog does not eliminate app registration, verification, scopes, or provider approval work. [First-party OAuth clients](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/apps/cloud/src/engine/first-party-oauth-clients.ts).

### Concrete API seams

These are routes present in pinned gateway source, normally mounted under `/api`; they are **not** a vendor guarantee of a stable embedded public API. Zuse should expose its own stable application API instead.

| Capability | Executor route |
| --- | --- |
| List integration definitions | `GET /api/integrations` |
| List/create personal or shared connections | `GET`, `POST /api/connections` |
| Inspect/update/delete a connection | `GET`, `PATCH`, `DELETE /api/connections/:owner/:integration/:name` |
| Refresh/check health | `POST /api/connections/:owner/:integration/:name/refresh`, `/health` |
| Register/list OAuth client metadata | `POST`, `GET /api/oauth/clients` |
| Dynamic client registration | `POST /api/oauth/clients/register-dynamic` |
| Start/complete/cancel OAuth | `POST /api/oauth/start`, `/complete`, `/cancel` |
| Browser callback | `GET /api/oauth/callback` |
| Execute/resume | `POST /api/executions`, `/api/executions/:executionId/resume` |

Sources: [connections API](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/api/src/connections/api.ts), [integrations API](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/api/src/integrations/api.ts), [OAuth API](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/api/src/oauth/api.ts), [execution API](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/api/src/executions/api.ts), [self-host mount](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/apps/host-selfhost/src/app.ts).

### MCP is an access surface, not just code execution

The service proxies MCP, OpenAPI, and GraphQL-backed tools; credentials attach upstream at the host. Both local and cloud agents can access one reachable HTTP MCP service. This does not automatically synchronize a local-only daemon with the cloud or make a private/local MCP endpoint reachable from cloud infrastructure. [MCP proxy docs](https://executor.sh/docs/mcp-proxy).

Current source supports default codemode (`execute` plus supporting tools) and `?mode=passthrough` with search/invoke discovery. Optional integration-specific search tools also exist. Neither should be confused with automatically exposing each upstream tool as an independent static MCP tool. The source comments and evolving implementation warrant a tools/list capability test for the exact pinned version. Choose one Zuse tool surface deliberately and test it against each agent driver. [MCP server](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/hosts/mcp/src/tool-server.ts).

Recommended Zuse arrangement: provider refresh/access tokens stay in the centralized integration service; local/cloud agent runtimes receive narrow, revocable Zuse grants through the existing gateway bridge. The bridge carries execution and approval interactions to the same personal connection. The user connects once because the underlying connection is centralized, not because upstream secrets are copied to every machine.

### White-label work is real

Self-hosting allows a canonical custom origin via `EXECUTOR_WEB_BASE_URL`, used for callbacks and generated links. But source hardcodes OAuth client names `Executor` / `Executor Local`, MCP server identity `executor`, and instructions that direct users to reconnect in Executor. Merely hiding the dashboard or reverse-proxying the hosted service will not satisfy “no Executor in frontend.” [Self-host docs](https://executor.sh/docs/hosted/docker), [OAuth metadata](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/api/src/server/oauth-client-metadata.ts), [agent-facing instructions](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/hosts/mcp/src/passthrough-tools.ts).

Use Zuse UI, Zuse callback/completion pages, Zuse OAuth app identities, and Zuse MCP tool descriptions. Prefer host configuration seams or a small upstreamable branding extension to a full UI fork. Audit consent screens, reconnect errors, approval links, metadata, and generated prompts. Provider-owned consent screens will still identify the provider and requested permissions.

## Operations, license, pricing, and maturity

The pinned root license is MIT and requires preservation of its copyright and permission notice in copies or substantial portions. It contains no express UI attribution clause. This is the observed text, not a conclusion about hosted-service resale, trademarks, registry content rights, or provider contracts. Preserve license notices; confirm the latter terms separately. [Pinned LICENSE](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/LICENSE).

Public cloud pricing is $0 for up to three members and 100,000 executions/month, $15/member/month for Team with unlimited executions, and custom Enterprise. Enterprise advertises dedicated/self-host support, SSO and security-review material on request. These are employee/team prices, not a published embedded end-user contract; do not extrapolate Zuse costs or claim an independently verified certification. [Pricing](https://executor.sh/pricing).

The gateway Docker image is an all-in-one process using libSQL/SQLite and local encryption keys. Its documented setup has one organization, invite-based user creation, and a persisted `/data` volume. The stock image is useful for evaluation, but it is not automatically Zuse's production control plane. Cloud source has separate database, identity, and execution-stack seams. Horizontal scaling, migration/rollback, backup restore, encryption-key rotation, and per-tenant quotas need an explicit Zuse hosting design. [Gateway Docker source docs](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/apps/docs/hosted/docker.mdx), [cloud middleware](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/apps/cloud/src/api/protected.ts).

Source includes OAuth lifecycle tests, cross-session refresh scenarios, ownership tests, and token rotation/concurrency fixtures. This is encouraging engineering evidence, **not executed verification or proof of multi-replica correctness**. An outdated API-file comment says OAuth start/complete are stubbed, while SDK flow tests implement that lifecycle: inspect behavior rather than trusting individual comments. [OAuth flow tests](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/sdk/src/oauth-flow.test.ts), [cross-session test](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/e2e/selfhost/oauth-refresh-cross-session.test.ts).

## Required live spike and adoption gates

1. Bind two verified Zuse users to distinct subjects; prove no cross-user connection discovery, invocation, refresh, callback completion, or approval resumption. Repeat cross-tenant and with forged connection identifiers.
2. Connect a remote MCP supporting automatic client registration through a Zuse-owned origin, without manually creating a provider OAuth app. Verify Zuse client metadata, cancellation, duplicate clicks, state replay, expired state, browser-to-desktop completion, and reconnect without any Executor branding. Also verify a public MCP requiring no OAuth.
3. Use the same connection from one local and one cloud session with separate revocable runtime grants; no provider token may enter either runtime, model context, or client logs.
4. Refresh the same rotating token concurrently from separate service processes. Kill a process after upstream rotation but before persistence; establish recovery behavior and locking/storage guarantees.
5. Disconnect during an active session, paused approval, refresh, and in-flight request. Establish which already-started calls may finish, and ensure no new calls succeed. Distinguish local deletion from upstream provider revocation and test both.
6. Verify tools/list, search/invoke or execute, errors, approval UX, catalog changes, and reconnect behavior for every supported Zuse agent; do not rely on blanket “any MCP client” marketing.
7. Exercise provider 429, timeout, partial response, invalid_grant, revoked access, and service restart. Confirm bounded retries, idempotency behavior, redacted diagnostics, and actionable reconnect state.
8. Decide supported upstream release/version, maintenance ownership, production storage/scaling, provider-app approvals, registry licensing, and whether a paid vendor agreement is needed.

The upstream source/tests were inspected, not executed. A pinned Biome 2.5.3 check of this document and the plan exited successfully with zero files checked (Markdown is unsupported). Type and behavior checks are not applicable to these research-only Markdown changes; real OAuth and runtime validation remain the adoption gates above.

## Implementation-shaping findings from final source review

**Use the actual pinned SDK API:** `executor.tools.list(filter)`, `executor.tools.schema(address)`, and `executor.execute(address, args, options)`. There is no `executor.tools.invoke` in this interface. The direct `execute` method takes a tool address and structured arguments; it does not require exposing arbitrary generated JavaScript to an agent. Older README examples using scope stacks are stale relative to the tenant/subject binding. [Executor interface](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/sdk/src/executor.ts).

**Do not copy the stock passthrough approval semantics.** Its MCP implementation automatically accepts policy-origin elicitation because it assumes the client already approved its generic destructive `invoke` tool; it forwards upstream prompts separately. That assumption is unsuitable as Zuse's service-side authorization guarantee. Supply an explicit `onElicitation` handler through direct SDK execution, authenticate the human approval, and bind approval to the actual user, session, connection, tool, arguments, expiry, and policy version. Do not configure `accept-all`. Handling paused calls across process restarts remains a Zuse integration design/test requirement; an in-memory waiting callback is insufficient. [Passthrough call implementation](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/hosts/mcp/src/tool-server.ts#L1980), [elicitation types](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/packages/core/sdk/src/elicitation.ts).

For the first spike, a **dedicated Node service with durable database and secret storage**, calling the SDK through the narrow adapter, is the most direct evaluable deployment. Keep its external interface compatible with later placement in Zuse's cloud stack. A Cloudflare deployment is plausible because upstream has a Cloudflare-based cloud host, but copying that host entails WorkOS, billing, execution, database, and session composition. Worker compatibility, outbound MCP streaming, storage adapters, and refresh coordination should be measured before choosing that as the implementation target. This deployment preference is an inference, not a benchmark or completed compatibility test. [Cloud composition](https://github.com/UsefulSoftwareCo/executor/blob/98d606bd2b47b9dcc2c03a129a14b5134d9852c8/apps/cloud/src/api/protected.ts).
