-- Earlier staging branch builds applied this schema before main's 0027/0028.
-- Reconcile additively after those migrations without replacing existing data.
ALTER TABLE "api_environments" ADD COLUMN IF NOT EXISTS "sharing_audience" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_environments_sharing_idx" ON "api_environments" USING gin ("sharing_audience");
