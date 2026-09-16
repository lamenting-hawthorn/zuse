ALTER TABLE "api_environments" ADD COLUMN "sharing_audience" jsonb;
--> statement-breakpoint
CREATE INDEX "api_environments_sharing_idx" ON "api_environments" USING gin ("sharing_audience");
