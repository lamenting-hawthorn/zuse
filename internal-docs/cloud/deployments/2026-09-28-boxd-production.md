# Boxd production rollout

Enabled Boxd on `api.zuse.sh` using source commit
`fc2b6b4a4ed2cfef679bd98411880c3d5f850b69`, based on main
`35af66800c7c210815741aa2a9ace85e759a4532`.

- Worker: `zuse-relay`.
- Version: `0dbb69a4-add9-4093-a18d-2cbd6710fd27`, verified at 100% traffic.
- Deployment: `e7a75e43-c996-4cb9-b1ab-871c9195b47e`.
- Time: September 28, 2026, 19:52 UTC.
- Organization: `zuse`; template: `zuse-base-v20260927-1`; version:
  `20260927-1`; default machine size: `default`.
- Installed a dedicated organization-fenced `BOXD_API_KEY` production secret.
  The temporary local key copy was removed after installation.

All existing production text settings were verified unchanged. Boat remains the
placement default; E2B remains the default authentication authority. Billing
enforcement and export were already disabled and remain disabled. The existing
verified Boxd template was reused; no runtime publication or database migration
was performed.

## Verification

- Scoped Biome passed.
- API, sandbox-provider and dependency types passed (11 tasks).
- API unit suite: 376 initially passed; two deployment-fixture failures were
  fixed by including the newly required Boxd secret. All 22 deployment-safety
  tests passed on rerun, alongside all 182 provider unit tests.
- Production Worker dry-run passed in the cloud checkout and on the Mac using
  the exact deployed commit and frozen dependencies.
- Live Boxd lifecycle passed in 53.02 seconds with the production key and
  template: allocation, installed runtime, protected HTTP, SSH upgrade handling,
  HTTPS/WebSocket proxying, file persistence, hibernate/resume, process
  replacement, snapshot, fork, and cleanup. Resume took 2.33 seconds in this run.
- Cloudflare confirms the enabled adapter, template, organization, installed
  secret, and deployed version at 100% traffic.
- Production `/v1/cloud/providers` returned the expected `401 missing_bearer`
  using curl from both the Mac and cloud workspace. A Python urllib probe was
  blocked by Cloudflare with 403/1010; the curl probes reached the Worker.
- API terminology check passed. The broader architecture check reports two
  pre-existing legacy-supervisor violations in renderer `file-tree-client-bus.ts`.

The app browser was unavailable. Authenticated production provider discovery,
account-image build, and an actual agent conversation were not verified. The
live adapter test does not establish those app-level flows.

## Rollback

Previous Worker version: `7a0f8b95-ab2a-41f8-b65c-235382a845f3`.
Prefer an intentional configuration rollback that preserves access to existing
Boxd workspaces. Do not delete machines, snapshots, account images, or data as
part of a Worker rollback.
