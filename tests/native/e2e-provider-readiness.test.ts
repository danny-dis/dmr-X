import { describe, expect, it } from 'bun:test';
import { hasUsableProviders } from '../e2e/provider-readiness.ts';

describe('E2E provider readiness', () => {
  it('runs inference checks when catalog and candidate readiness agree', () => {
    expect(hasUsableProviders({ data: [{ id: 'active-model' }] }, { checks: { candidates: { status: 'ok' } } })).toBe(true);
  });
  it('fails closed when readiness data is missing', () => {
    expect(hasUsableProviders({ data: [{ id: 'catalog-only-model' }] })).toBe(false);
  });
  it('does not run inference checks with an empty catalog', () => {
    expect(hasUsableProviders({ data: [] }, { checks: { candidates: { status: 'ok' } } })).toBe(false);
  });
  it('does not equate a nonempty catalog with available routing candidates', () => {
    expect(hasUsableProviders({ data: [{ id: 'catalog-only-model' }] }, { checks: { candidates: { status: 'fail' } } })).toBe(false);
  });
});
