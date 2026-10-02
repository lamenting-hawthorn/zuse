CREATE TABLE api_model_connections (
 account_id text NOT NULL,
 provider text NOT NULL CHECK (provider IN ('chatgpt','supergrok')),
 kind text NOT NULL CHECK (kind IN ('active','pending')),
 connection_id text NOT NULL,
 envelope text NOT NULL,
 PRIMARY KEY(account_id,provider,kind,connection_id)
);
--> statement-breakpoint
CREATE TABLE api_model_connection_leases (
 account_id text NOT NULL,
 provider text NOT NULL CHECK (provider IN ('chatgpt','supergrok')),
 token text NOT NULL,
 expires_at_ms bigint NOT NULL,
 PRIMARY KEY(account_id,provider)
);
