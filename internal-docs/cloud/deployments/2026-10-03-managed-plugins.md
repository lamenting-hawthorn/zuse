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
