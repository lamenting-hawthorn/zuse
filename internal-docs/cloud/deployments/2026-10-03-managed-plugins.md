# Managed plugins staging deployment

Source: `724864cad50612e44d3a122b4b9e035641538da0` on
`swarajbachu/mcp-plugin-ecosystem`. Production was not changed.

- API: `zuse-relay-staging`, version `1f7d84a1-c0f2-4e8a-98c4-ea7219b2b7e5`,
  serving `https://api-staging.zuse.sh`.
- Web: `https://zuse-lqudgtn2r-swarajbachus-projects.vercel.app`, aliased to
  `https://code-staging.zuse.sh`. The staging domain's branch assignment and
  the three public staging build variables now target this branch. Vercel
  Deployment Protection remains enabled.
- Runtime: [successful signed build and publication](https://github.com/swarajbachu/zuse/actions/runs/37100631703),
  published to `cloud-runtime-staging`. The downloaded channel manifest matches
  the source commit and verifies against the configured staging public key.

The previous API version was `91badfe1-4d09-496d-a006-8f9f17b6d201`, with no
plugin vault binding or plugin encryption key. This deployment created the
SQLite Durable Object class with migration `plugins-v1`. A dedicated key was
installed as `PLUGIN_ENCRYPTION_KEY`; its recovery copy is in the deploying
Mac's login Keychain, service `zuse-staging-plugin-encryption-key`, account
`zuse-relay-staging`. Do not rotate it without migrating stored ciphertexts.

Verification: API/server/renderer type checks, 35 API/plugin/deployment tests,
12 agent tests, and the plugin browser regression passed. Biome passed with
existing driver warnings. Live API checks confirmed missing-bearer rejection,
untrusted-origin rejection, and the plugin route's expected method validation.
Authenticated Vercel asset checks confirmed the app HTML, staging API and WorkOS
configuration, and the deployed plugin RPC mapping.

Real provider OAuth consent and tool invocation from a signed-in desktop/cloud
session remain manual smoke checks. Start or update a staging runtime before
testing agent tools; publishing the runtime does not restart existing sessions.
Local desktop testing requires this branch's desktop build.

Rollback must preserve the plugin namespace and encryption key. Do not delete
Durable Object data or reverse migrations destructively. Coordinate API, web,
and runtime versions if rolling back; production was not part of this rollout.

## Startup compatibility follow-up

A signed-in staging session exposed a settings API 500: saved
`defaultModelByProvider` lacked the newly introduced `zuse` key. Commit
`23c7e595` makes persisted provider maps sparse and fills missing UI entries
from current product defaults, preserving saved choices. This does not mutate
stored settings or plugin credentials.

Redeployed API version: `5c13c7bd-4ddb-4caa-9d99-ddad18dc467e`.
Redeployed web: `https://zuse-cuq34s0rb-swarajbachus-projects.vercel.app`,
activated at `https://code-staging.zuse.sh`. The signed cloud runtime remains
the original plugin deployment. Contracts/API/server/renderer type checks,
62 targeted tests, Biome, and the plugin browser regression passed. Verified
the staging alias serves the new bundle. The original signed-in session needs
a reload to load the new frontend; an authenticated post-fix settings request
was not captured during this deployment.

## OAuth callback follow-up

The public callback returned HTTP 500 because both mailbox directive parsing
and response-effect cleanup tried to mutate immutable Durable Object response
headers. The internal callback fetch also followed its redirect instead of
returning it to the browser. Commits `7ec1c537` and `3d711aec` fix redirect
handling and shared middleware response handling.

Staging API version: `3eda9335-3ecb-4bc2-a4d3-a2dc4531da7b`. API type checks,
Biome, and 17 targeted tests passed. The OAuth integration regression now
crosses the Worker-to-Durable-Object boundary and mailbox/header middleware,
then verifies owner confirmation and replay rejection. A live callback request
without OAuth credentials changed from HTTP 500 to the expected HTTP 400.
The user's authorization code was not replayed. Failed attempts must be
cancelled and restarted to obtain a fresh confirmation redirect.

## Linear issuer confirmation follow-up

Linear advertises `authorization_response_iss_parameter_supported: true`.
The vault retained the authorization code and state but discarded `iss` before
calling the SDK's OAuth validator. Commit `805cde89` retains the issuer in the
encrypted attempt and forwards it unchanged for validation, clearing it with
the terminal attempt data. Missing or mismatched issuers remain rejected.
The confirmation UI now uses a general failure message rather than claiming
that every failure is expiry or an account mismatch.

API version: `c85aaf1d-a37c-47f3-8761-ab1a068fefb6`.
Web: `https://zuse-be38g26uc-swarajbachus-projects.vercel.app`, aliased to staging.
API and renderer type checks, Biome, 12 plugin tests and the browser regression
passed. The OAuth fixture now advertises issuer validation and exercises valid,
missing and mismatched issuer responses. The valid confirmation test failed
before the fix and passed afterward. A fresh real-account consent attempt is
required because previous attempts did not retain the issuer.

## Catalog and return-flow update

Deployed from the uncommitted `swarajbachu/mcp-plugin-ecosystem` working tree
(on top of `abeb31de`) as API version `cba4bea2-9bf1-4dba-91b4-4ffb7fed1a14`;
the previous version was `c85aaf1d-a37c-47f3-8761-ab1a068fefb6`. No Durable
Object migration or secret change. This adds the generated integrations.sh
catalog (906 entries), lazy engine registration, auth probing, the shared
outbound policy, and desktop/web OAuth returns without a hosted confirmation
click. Existing `linear` and `cloudflare` connections keep their build IDs.
Live checks: unauthenticated `/v1/plugins` returns 401 and an unknown callback
returns 400. The web app was not redeployed, so `code-staging.zuse.sh` still
serves the previous renderer; the desktop return needs this branch's desktop
build.
