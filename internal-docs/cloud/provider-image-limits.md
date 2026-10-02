# Provider image and snapshot limits

Verified against first-party documentation on 2026-10-02. These are public defaults, not confirmation of Zuse's account-specific quotas. Boat's reported 10 named snapshots is comparison context supplied by the user, not independently verified here.

## Summary

| Provider | Reusable image count | Other limits that must not be confused with image count |
| --- | --- | --- |
| E2B | Explicitly no current template-count limit | 20 simultaneous builds on Hobby/Pro; sandbox concurrency and runtime are separate |
| Boxd | No named-snapshot-count limit published in the reviewed pages; not evidence of unlimited capacity | 10 checkpoints per machine; normally 50 machines per organization, including hibernated machines |

## E2B

The [template quickstart, Scaling templates](https://docs.e2b.dev/template/quickstart#scaling-templates) explicitly permits arbitrarily many templates, including per-customer/project/run use. It warns that aggregate template-storage pricing may be introduced later. This is stronger evidence than merely finding no quota in a pricing table. The same page's [build limits](https://docs.e2b.dev/template/quickstart#build-limits) specify a one-hour build timeout, 20 concurrent builds on Hobby and Pro, and per-build disk ceilings of 10 GiB on Hobby and 20+ GiB on Pro. Those disk limits are not an aggregate image-storage allowance.

[Billing and limits](https://docs.e2b.dev/billing) lists Hobby at $0/month with 20 concurrent sandboxes and one-hour continuous runtime; Pro at $150/month plus usage with 100–1,100 concurrent sandboxes and 24-hour continuous runtime; Enterprise has custom limits. Paused-sandbox retention is unlimited and pausing resets the continuous-runtime window. These limits do not impose a template-count quota.

[Template tags and versioning](https://docs.e2b.dev/template/tags) separates a template name, tags, and build artifacts. Multiple tags can refer to one artifact; builds can be selected by build ID; removing a tag does not delete the underlying artifact. Therefore a stable template name is not proof that rebuilds reclaim old storage. The reviewed docs do not specify an old-build retention/garbage-collection policy or a separate total stored-build/tag quota.

[Sandbox snapshots](https://docs.e2b.dev/sandbox/snapshots) are live disk-and-memory captures, distinct from declarative templates. The page documents listing and deleting snapshots but does not publish a snapshot-count quota. Do not extend the explicit unlimited-template statement to runtime snapshots without confirmation.

## Boxd

Zuse's provider is `boxd.sh` (`packages/sandbox-providers/src/boxd.ts`), not Box.com.

[Resources and limits](https://docs.boxd.sh/guides/resources.md) publishes 10 checkpoints per machine and unlimited runtime. The default organization machine cap is 50, or two before adding a payment method. Forks, golden machines, and hibernated machines all count; destroyed machines do not. The provider offers quota increases. These are machine/checkpoint quotas, not a published named-snapshot quota.

[Snapshots](https://docs.boxd.sh/guides/snapshots.md) are named disk-and-memory captures that outlive their source machine. Saving again under the same name creates a new version: new machines continue using the previous version until the replacement is ready, then the older version is cleaned up. This supports bounded same-name refreshes, but separate names remain separate snapshots. No maximum named-snapshot count or aggregate snapshot-storage allowance is stated on that page. The [golden-image guide](https://docs.boxd.sh/guides/golden-image.md) recommends refreshing a stable snapshot name on each push to main.

[Pricing](https://boxd.sh/pricing/) is credit-based with no monthly plan or seat fee. Machine disk is billed at €0.0001/GiB-hour for written space in every lifecycle state; hibernation is not literally free. The rate card does not clearly explain standalone named-snapshot billing, shared-block accounting, or temporary storage during replacement. Do not assume machine disk pricing answers those questions.

## Follow-up before capacity planning

- Ask E2B about stored-build retention/cleanup, runtime-snapshot quotas, and any planned aggregate template-storage billing.
- Ask Boxd for Zuse's named-snapshot quota, aggregate storage limit and billing, and whether replacing a snapshot requires transient quota headroom.
- Inspect account-specific limits separately; no authenticated provider resources were created, rebuilt, or deleted for this research.
