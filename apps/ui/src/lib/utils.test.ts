import { describe, it, expect } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('merges conflicting Tailwind spacing utilities, keeping the last one per axis', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('keeps the last of two directly conflicting classes', () => {
    expect(cn('p-2', 'p-4', 'p-2')).toBe('p-2');
  });

  it('merges conflicting color utilities to the last one', () => {
    expect(cn('bg-red-500 text-white', 'bg-blue-500')).toBe('text-white bg-blue-500');
  });

  it('drops falsy/undefined/null inputs', () => {
    expect(cn('foo', undefined, null, false, 0 as unknown as false, 'bar')).toBe('foo bar');
  });

  it('honors clsx object and array syntax', () => {
    expect(cn(['a', 'b'], { c: true, d: false })).toBe('a b c');
  });

  it('resolves conditional class names', () => {
    const active = false;
    expect(cn('text-red-500', active && 'text-blue-500', 'text-green-500')).toBe('text-green-500');
  });

  it('returns an empty string when given nothing usable', () => {
    expect(cn()).toBe('');
    expect(cn(undefined, null, false)).toBe('');
  });

  it('leaves non-conflicting classes in place, untouched', () => {
    expect(cn('flex items-center', 'gap-2')).toBe('flex items-center gap-2');
  });
});
