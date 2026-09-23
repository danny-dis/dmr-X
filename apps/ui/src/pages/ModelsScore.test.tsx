import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { formatRouterScore, MODELS_TABLE_SKELETON } from './Models';

describe('Models table', () => {
  it('does not present an unobserved router prior as a measured score', () => {
    expect(formatRouterScore({ mean: 0.5, pulls: 0 })).toBe('Prior');
    expect(formatRouterScore({ mean: 0.84, pulls: 3 })).toBe('84');
  });

  it('renders one loading cell per table header', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(MODELS_TABLE_SKELETON);
    expect(container.querySelectorAll('th')).toHaveLength(8);
    expect(container.querySelectorAll('tbody tr:first-child td')).toHaveLength(8);
  });
});
