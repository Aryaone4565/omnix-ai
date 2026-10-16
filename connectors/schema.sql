-- OMNIX Connect: D1 schema
-- Apply to the D1 database bound as OMNIX_DB before enabling connector routes.
-- Secrets must be encrypted by the Worker using a server-side OMNIX_ENCRYPTION_KEY.
-- Never store plaintext OAuth tokens, bot tokens, or API keys here.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS omnix_connector_configs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  connector_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  connector_type TEXT NOT NULL CHECK (connector_type IN ('remote','mcp-remote','mcp-custom','builtin')),
  endpoint_url TEXT,
  encrypted_credentials TEXT,
  requested_permissions TEXT NOT NULL DEFAULT '[]',
  enabled_tools TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','disabled','revoked','error')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(owner_id, connector_key, endpoint_url)
);

CREATE INDEX IF NOT EXISTS idx_omnix_connector_owner
  ON omnix_connector_configs(owner_id, status);

CREATE TABLE IF NOT EXISTS omnix_connector_approvals (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  arguments_preview TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(connector_id) REFERENCES omnix_connector_configs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_omnix_approval_owner_expiry
  ON omnix_connector_approvals(owner_id, expires_at, used_at);

CREATE TABLE IF NOT EXISTS omnix_connector_audit (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  connector_id TEXT,
  action TEXT NOT NULL,
  tool_name TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','denied','error','pending')),
  detail_redacted TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_omnix_connector_audit_owner_time
  ON omnix_connector_audit(owner_id, created_at);

CREATE TABLE IF NOT EXISTS omnix_connector_oauth_states (
  state_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  connector_key TEXT NOT NULL,
  code_verifier_encrypted TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
