-- Memory embeddings for semantic search
ALTER TABLE memory_items ADD COLUMN embedding BLOB;
ALTER TABLE memory_items ADD COLUMN embedding_dim INTEGER;
