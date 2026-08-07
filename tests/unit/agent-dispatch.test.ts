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
      // catMatch: +3 category, plus a full keyword match ("search" appears as
      // a whole word in the description). keywordOnly: no category match, and
      // "search" is only a substring of "searchbot" (not a whole word), so
      // whole-word matching correctly scores it 0.
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

    it('scores the fraction of distinct task keywords matched as whole words, times KEYWORD_WEIGHT(3)', () => {
      const d = def({ name: 'pdf extractor', description: 'parse and summarize pdf documents' });
      // task terms: "extract" does NOT match "extractor" (whole-word matching,
      // not substring -- this is the bug-A fix), "pdf" matches, "summarize"
      // matches. 2 of 3 distinct keywords matched -> (2/3) * 3 = 2.
      const s = scoreDefinition(d, 'extract pdf summarize');
      expect(s).toBe(2);
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
      // +3 category, +2 tag. Keyword terms: "scrape" does NOT match "scraper"
      // (whole-word matching, not substring), "web" matches, "pages" matches.
      // 2 of 3 distinct keywords matched -> (2/3) * 3 = 2. Total: 3 + 2 + 2.
      expect(s).toBe(3 + 2 + 2);
    });

    it('does not match a keyword as a substring of an unrelated word', () => {
      // "api" must not match inside "rapid", "man" must not match inside
      // "management", "cat" must not match inside "concatenate".
      const d = def({ name: 'rapid management', description: 'concatenate strings' });
      expect(scoreDefinition(d, 'api')).toBe(0);
      expect(scoreDefinition(d, 'man')).toBe(0);
      expect(scoreDefinition(d, 'cat')).toBe(0);
    });

    it('filters common stopwords out of task keywords', () => {
      const d = def({ name: 'alpha', description: 'the and for has can are not' });
      // Every task word here is a stopword; nothing survives the filter, so
      // there is no keyword component (not a spurious match against a
      // description that happens to contain the same stopwords).
      expect(scoreDefinition(d, 'the and for has can')).toBe(0);
    });

    it('de-duplicates repeated task keywords instead of compounding the score', () => {
      const d = def({ name: 'model router', description: 'routes to a model' });
      const repeated = scoreDefinition(d, 'model model model');
      const single = scoreDefinition(d, 'model');
      expect(repeated).toBe(single);
    });

    it('normalizes for description length so a verbose match does not outrank a precise one', () => {
      const precise = def({ name: 'pdf', description: 'pdf' });
      const verbose = def({
        name: 'pdf',
        description: 'pdf plus a very long description with lots of unrelated filler content padding it out',
      });
      // Both fully match the single task keyword "pdf" -> same normalized
      // score, regardless of how much extra text the description carries.
      expect(scoreDefinition(precise, 'pdf')).toBe(scoreDefinition(verbose, 'pdf'));
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
