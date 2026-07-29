/**
 * Chart colours resolved from the CSS design tokens.
 *
 * Every chart wrapper used to hardcode hex, and three separate files
 * (Dashboard, Usage, Gauge) each kept a private `TONE` map duplicating the
 * same values. That meant charts rendered dark-theme colours in light theme
 * and any token change had to be mirrored by hand in four places.
 *
 * Reading the computed custom property keeps charts on the same palette as
 * the rest of the UI, in whichever theme is active.
 */

export type ChartTone =
  | 'primary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'pink'
  | 'lime'
  | 'muted';

const TOKENS: Record<ChartTone, string> = {
  primary: '--primary',
  accent: '--accent',
  success: '--success',
  warning: '--warning',
  danger: '--danger',
  info: '--info',
  pink: '--pink',
  lime: '--lime',
  muted: '--text-dim',
};

/**
 * Fallbacks for SSR and for the first paint before styles resolve. These are
 * the dark-theme values from index.css; a wrong colour for one frame is
 * better than an empty string, which recharts renders as black.
 */
const FALLBACKS: Record<ChartTone, string> = {
  primary: '#7C5CFF',
  accent: '#22D3EE',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  info: '#60A5FA',
  pink: '#F472B6',
  lime: '#A3E635',
  muted: '#545B73',
};

export function chartColor(tone: ChartTone): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    return FALLBACKS[tone];
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(TOKENS[tone]).trim();
  return value || FALLBACKS[tone];
}

/**
 * Ordered palette for series with no inherent meaning (provider breakdowns,
 * model splits). Ordered for adjacent-hue contrast so neighbouring slices in a
 * donut stay distinguishable.
 */
export const CATEGORICAL: ChartTone[] = [
  'primary',
  'accent',
  'success',
  'warning',
  'pink',
  'info',
  'lime',
  'danger',
];

export function categoricalColor(index: number): string {
  return chartColor(CATEGORICAL[index % CATEGORICAL.length]);
}
