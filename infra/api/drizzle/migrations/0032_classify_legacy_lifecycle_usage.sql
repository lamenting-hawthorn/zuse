-- Preserve event IDs, quantities and timestamps. These counters measured time
-- until reconciliation, including provider-side pauses, not billed compute.
-- Do not modify provider settlement, Polar exports, or subscription balances.
-- Keep the old value valid for an API rollback; new writers use the explicit label.
ALTER TABLE api_cloud_workspace_usage DROP CONSTRAINT IF EXISTS api_cloud_usage_kind_check;
ALTER TABLE api_cloud_workspace_usage DROP CONSTRAINT IF EXISTS relay_cloud_usage_kind_check;
ALTER TABLE api_cloud_workspace_usage ADD CONSTRAINT api_cloud_usage_kind_check
CHECK (kind IN ('runtime-seconds', 'lifecycle-elapsed-seconds', 'pause', 'resume', 'snapshot-bytes', 'storage-byte-seconds', 'archive', 'restore', 'delete'));
UPDATE api_cloud_workspace_usage
SET kind = 'lifecycle-elapsed-seconds'
WHERE kind = 'runtime-seconds';
