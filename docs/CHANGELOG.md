# Changelog

## v1.0.0 - Current Refactor Baseline

- Removed generated TypeScript artifacts from source folders.
- Removed orphaned prototype UI source under `proto ui/app`.
- Tightened test discovery and generated-file ignores.
- Fixed unused imports and locals reported by TypeScript.
- Fixed UI build parsing by removing an unnecessary Vite esbuild override.
- Simplified MCP server tool registration types to avoid TypeScript heap exhaustion.
- Rewrote environment documentation and production setup docs.
