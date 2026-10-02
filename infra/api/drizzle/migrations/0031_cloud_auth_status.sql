-- Public authentication status only: credentials remain on the authority disk.
ALTER TABLE api_cloud_auth_authorities ADD COLUMN status jsonb;
