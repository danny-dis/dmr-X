import { describe, it, expect } from 'vitest';

import {
  scoreDefinition,
  compareCandidates,
  type DispatchCandidate,
} from '../../apps/gateway/src/routes/agent-dispatch.routes.js';

const def = (over: {
  name: string;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
}) => ({ name: over.name, description: over.description ?? null, category: over.category ?? null, tags: over.tags ?? null });

describe('agent-dispatch scoring', () => {
  describe('scoreDefinition()', () => {
    it('awards +3 for an exact category match', () => {
      const a = def({ name: 'alpha', category: 'search' });
      const b = def({ name: 'beta', category: 'codegen' });
      expect(scoreDefinition(a, 'find stuff', 'search')).toBe(3);
      expect(scoreDefinition(b, 'find stuff', 'search')).toBe(0);
    });

    it('gives a category match strictly more weight than keyword hits', () => {
      const catMatch = def({ name: 'searcher', description: 'does search', category: 'search' });
      const keywordOnly = def({ name: 'searchbot', description: 'no category here', category: 'other' });
      // catMatch: +3 category. keywordOnly: "search" appears in name=+1, "bot" maybe not a keyword.
      expect(scoreDefinition(catMatch, 'search', 'search')).toBeGreaterThan(
        scoreDefinition(keywordOnly, 'search', 'search'),
      );
    });

    it('awards +2 for each overlapping tag', () => {
      const a = def({ name: 'alpha', tags: ['fast', 'web', 'doc'] });
      const b = def({ name: 'beta', tags: ['slow', 'doc'] });
      expect(scoreDefinition(a, 'x', undefined, ['web', 'doc', 'extra'])).toBe(4);
      expect(scoreDefinition(b, 'x', undefined, ['web', 'doc'])).toBe(2);
    });

    it('awards +1 for each keyword hit in name or description', () => {
      const d = def({ name: 'pdf extractor', description: 'parse and summarize pdf documents' });
      // task terms: extract (matches "extractor"), pdf (name+desc), summarize (matches "summarize")
      const s = scoreDefinition(d, 'extract pdf summarize');
      expect(s).toBe(3);
      // No keyword overlap -> 0 (terms kept are >2 chars, none present)
      expect(scoreDefinition(def({ name: 'foo', description: 'bar baz' }), 'zzz qqq')).toBe(0);
    });

    it('is case-insensitive for keyword matching', () => {
      const lower = scoreDefinition(def({ name: 'PDF Tool' }), 'pdf tool');
      const upper = scoreDefinition(def({ name: 'PDF Tool' }), 'PDF TOOL');
      expect(lower).toBe(upper);
      expect(lower).toBeGreaterThan(0);
    });

    it('combines category, tag and keyword contributions', () => {
      const d = def({ name: 'web scraper', description: 'fetch pages', category: 'web', tags: ['scrape', 'crawl'] });
      const s = scoreDefinition(d, 'scrape web pages', 'web', ['scrape']);
      // +3 category, +2 tag, keyword hits for "scrape"(name), "web"(name), "pages"(desc) = +3
      expect(s).toBe(3 + 2 + 3);
    });

    it('returns 0 when no hints/keywords match', () => {
      const d = def({ name: 'alpha', description: 'does alpha things', category: 'misc', tags: ['x'] });
      expect(scoreDefinition(d, 'completely unrelated phrase', 'other', ['y'])).toBe(0);
    });
  });
});

describe('agent-dispatch tie-breaking', () => {
  const cand = (over: Partial<DispatchCandidate> & { score: number }): DispatchCandidate => ({
    score: over.score,
    categoryMatch: over.categoryMatch ?? false,
    matchingTagCount: over.matchingTagCount ?? 0,
    instance: over.instance ?? {},
    definition: over.definition ?? {},
  });

  it('prefers the higher score', () => {
    const a = cand({ score: 5 });
    const b = cand({ score: 2 });
    expect(compareCandidates(a, b)).toBeLessThan(0); // a wins
    expect(compareCandidates(b, a)).toBeGreaterThan(0); // b loses
  });

  it('breaks equal scores by category match', () => {
    const a = cand({ score: 3, categoryMatch: false });
    const b = cand({ score: 3, categoryMatch: true });
    expect(compareCandidates(a, b)).toBeGreaterThan(0); // b (category match) wins
  });

  it('breaks equal score+category by more matching tags', () => {
    const a = cand({ score: 3, categoryMatch: true, matchingTagCount: 1 });
    const b = cand({ score: 3, categoryMatch: true, matchingTagCount: 3 });
    expect(compareCandidates(a, b)).toBeGreaterThan(0); // b (more tags) wins
  });

  it('breaks further ties by most recent activity', () => {
    const a = cand({ score: 3, categoryMatch: true, matchingTagCount: 1, instance: { lastActivityAt: 100 } });
    const b = cand({ score: 3, categoryMatch: true, matchingTagCount: 1, instance: { lastActivityAt: 500 } });
    expect(compareCandidates(a, b)).toBeGreaterThan(0); // b (more recent) wins
  });

  it('breaks equal activity by lower load', () => {
    const a = cand({ score: 3, categoryMatch: true, matchingTagCount: 1, instance: { lastActivityAt: 100, load: 5 } });
    const b = cand({ score: 3, categoryMatch: true, matchingTagCount: 1, instance: { lastActivityAt: 100, load: 2 } });
    expect(compareCandidates(a, b)).toBeGreaterThan(0); // b (lower load) wins
  });

  it('is stable when everything is equal (first occurrence wins)', () => {
    const a = cand({ score: 3, categoryMatch: true, matchingTagCount: 1, instance: {} });
    const b = cand({ score: 3, categoryMatch: true, matchingTagCount: 1, instance: {} });
    expect(compareCandidates(a, b)).toBe(0); // stable: no reordering
  });

  it('falls back to updatedAt when lastActivityAt is absent', () => {
    const a = cand({ score: 3, instance: { updatedAt: 200 } });
    const b = cand({ score: 3, instance: { updatedAt: 900 } });
    expect(compareCandidates(a, b)).toBeGreaterThan(0);
  });
});
