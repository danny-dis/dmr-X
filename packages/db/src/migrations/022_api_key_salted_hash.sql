-- Re-hash existing API keys with salt for improved security
-- This migration adds a salt column and re-hashes all existing key_hash values
-- to use the new salted format (salt:hash) instead of plain SHA-256.

-- Add salt column to api_keys table
ALTER TABLE api_keys ADD COLUMN key_salt TEXT;

-- Note: The actual re-hashing of existing keys will be done by the application
-- on startup (in migrateApiKeysToSaltedHash function in client.ts).
-- This is because we need access to the original plaintext keys to re-hash them,
-- and those are not stored in the database.
