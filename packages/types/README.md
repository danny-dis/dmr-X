# @dmr-x/types

**MIT-licensed public type definitions for DMR-X.**

This package contains the core TypeScript type definitions extracted from
`packages/core` and re-licensed under MIT. It is the source-of-truth type
contract for all DMR-X SDKs and external consumers.

## Why MIT?

The DMR-X platform core is BSL-1.1, but the type definitions — the public
interface contracts — are MIT. This lets SDKs (Python, Go, JavaScript, etc.)
reference the canonical types without license friction.

## Usage

```typescript
import type { UnifiedRequest, UnifiedResponse, Modality, ProviderPreferences } from '@dmr-x/types';
```

All types are re-exported from the package root. See `src/index.ts` for
the full export list.

## SDK Reference

| SDK | Repository |
|-----|-----------|
| Python | `sdks/python/` |
| Go     | `sdks/go/`     |
| TypeScript (WIP) | `packages/types/` |
