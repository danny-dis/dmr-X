import { describe, it, expect } from 'vitest';

import { chartColor, categoricalColor, CATEGORICAL, type ChartTone } from './chartPalette';

describe('chartColor', () => {
  it('falls back to the documented dark-theme hex when no CSS custom property is set', () => {
    // jsdom provides `window`/`getComputedStyle`, but no stylesheet defines
    // the `--primary` etc custom properties, so `getPropertyValue` returns
    // '' and the function should fall through to FALLBACKS.
    expect(chartColor('primary')).toBe('#7C5CFF');
    expect(chartColor('danger')).toBe('#F87171');
    expect(chartColor('muted')).toBe('#545B73');
  });

  it('resolves a CSS custom property set on the document root over the fallback', () => {
    document.documentElement.style.setProperty('--accent', '#123456');
    expect(chartColor('accent')).toBe('#123456');
    document.documentElement.style.removeProperty('--accent');
  });

  it('trims whitespace around the resolved custom property value', () => {
    document.documentElement.style.setProperty('--success', '  #abcdef  ');
    expect(chartColor('success')).toBe('#abcdef');
    document.documentElement.style.removeProperty('--success');
  });

  it('returns a muted fallback for an unknown tone key', () => {
    expect(chartColor('bogus' as unknown as ChartTone)).toBe('#545B73');
  });
});

describe('categoricalColor', () => {
  it('resolves index 0 to the first categorical tone color', () => {
    expect(categoricalColor(0)).toBe(chartColor(CATEGORICAL[0]));
  });

  it('wraps around the palette length for an index past the end', () => {
    expect(categoricalColor(CATEGORICAL.length)).toBe(categoricalColor(0));
    expect(categoricalColor(CATEGORICAL.length + 3)).toBe(categoricalColor(3));
  });

  it('covers every tone in the ordered palette across one full cycle', () => {
    const colors = Array.from({ length: CATEGORICAL.length }, (_, i) => categoricalColor(i));
    const expected = CATEGORICAL.map((tone) => chartColor(tone));
    expect(colors).toEqual(expected);
  });

  it('wraps negative indices to valid colors', () => {
    expect(categoricalColor(-1)).toBe(categoricalColor(CATEGORICAL.length - 1));
    expect(categoricalColor(-2)).toBe(categoricalColor(CATEGORICAL.length - 2));
    expect(categoricalColor(-CATEGORICAL.length)).toBe(categoricalColor(0));
  });
});
