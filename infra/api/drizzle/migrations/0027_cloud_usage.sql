CREATE TABLE "api_cloud_runtime_observations" (
  "provider" text NOT NULL,
  "provider_sandbox_id" text NOT NULL,
  "observation" jsonb NOT NULL,
  PRIMARY KEY ("provider", "provider_sandbox_id")
);
--> statement-breakpoint
CREATE TABLE "api_cloud_usage_outbox" (
  "event_id" text PRIMARY KEY NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" bigint NOT NULL,
  "next_attempt_at" bigint NOT NULL,
  "attempt_count" bigint NOT NULL DEFAULT 0,
  "acknowledged_at" bigint,
  "last_error" text
);
--> statement-breakpoint
CREATE INDEX "api_cloud_usage_outbox_pending_idx" ON "api_cloud_usage_outbox" ("next_attempt_at", "event_id") WHERE "acknowledged_at" IS NULL;
