# Cloud onboarding and recovery

Cloud Workspace checkout uses the provider-neutral `CLOUD_WORKSPACE_OFFER_ID`.
Sandbox placement and billing entitlement are separate. Public billing copy must
refer to sandbox compute rather than one provider. An external checkout product
name must also be managed in the billing service; this checkout did not include
access to that external product configuration.

The app-wide cloud onboarding wizard follows GitHub installation/repository
selection, agent authentication, and an image build across all available providers. It opens
when an account gains a Cloud Workspace entitlement and has not completed setup.
The app root checks payment activation on focus and every two seconds while
checkout is pending. Completion is stored per account, with existing server
images preventing repeat onboarding on other devices. Finish later defers setup
for the current app session; Open setup guide in Cloud Workspace settings reopens it immediately.
On return, setup resumes at the first unfinished step and tracks all images still building.
Settings retain the shared controls for ongoing management. A single Rebuild action
requests an image for every available provider, with independent progress and
failure details. Setup completes only when all available providers are ready.
Provider availability is refreshed with image status, so a newly added provider
appears as needing a rebuild without resetting existing images or chats. The app root
monitors image status independently of the settings page. There is no floating notice;
progress and actions live inline in Cloud Workspace settings.
The monitor refreshes active builds every two seconds after each completed request, and idle status every
15 seconds. Focus and network recovery also refresh status. Cached data remains
available during failed reads. Account changes fence outstanding monitor reads.

Image freshness compares the saved build configuration digest with the current
repository configuration, runtime, and delivery capabilities. Project status
updates from another provider's build must not invalidate already built images.
Provider rows open a dialog for live logs, build settings, and history. Explicit
setup navigation opens immediately; background status failures do not silently
cancel the navigation.

Runtime credential delivery version 1 does not require an image rebuild when
credentials rotate. Older images require an update after authentication changes;
new images apply to new chats, and existing chats must not be silently recreated.
The recovery client must bypass cached grants while recovering, even if the grant
has not expired. Otherwise a retry can return the credential that just failed and
never notify failed sessions that authentication has recovered. Claude OAuth
expiration and authentication errors must be classified as recoverable auth
failures rather than generic session failures.

Prompt preparation is visible before mailbox acceptance. The optional desktop
command-target binding has a 500 ms dispatch budget; slow binding may finish in
the background. This bounds one avoidable pre-dispatch wait without changing
mailbox delivery or retry semantics. Runtime startup and Claude initialization
can still take longer. No live desktop was connected during this investigation,
so the reported 4–5 second incident and sub-second end-to-end latency were not
measured. Use existing renderer RPC diagnostics and runtime cloud timing logs to
separate dispatch, runtime readiness, and provider initialization in a live run.
