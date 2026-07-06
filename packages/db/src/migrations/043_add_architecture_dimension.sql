-- Formalize ModelArchitecture as Dimension 2 of the 9-dimension taxonomy.
-- The 'architecture' column was added in migration 041 but not typed as a taxonomy dimension.
-- Rename to 'architecture_tier' for consistency with other taxonomy column names.

-- Rename column (SQLite doesn't support ALTER COLUMN, so we need to recreate the table)
-- Since we can't rename columns in SQLite, we'll just add an index for the existing column
-- and update the application code to use it as Dimension 2.

CREATE INDEX IF NOT EXISTS idx_model_profiles_architecture ON model_profiles(architecture);
