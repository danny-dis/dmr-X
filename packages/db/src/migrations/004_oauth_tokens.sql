-- OAuth token storage for providers
-- Tokens are stored encrypted using the same AES-256-GCM scheme as API keys

ALTER TABLE providers ADD COLUMN oauth_access_token TEXT;
ALTER TABLE providers ADD COLUMN oauth_refresh_token TEXT;
ALTER TABLE providers ADD COLUMN oauth_token_expires_at TEXT;
ALTER TABLE providers ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'api_key';
