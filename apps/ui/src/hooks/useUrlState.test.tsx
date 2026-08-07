import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router';

import { useUrlState, useUrlNullableState } from './useUrlState';

function wrapper(initialEntries: string[] = ['/']) {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );
}

describe('useUrlState', () => {
  it('returns the default value when the URL has no matching param', () => {
    const { result } = renderHook(() => useUrlState('tab', 'overview'), {
      wrapper: wrapper(['/']),
    });
    expect(result.current[0]).toBe('overview');
  });

  it('reads the current value from the URL when the param is present', () => {
    const { result } = renderHook(() => useUrlState('tab', 'overview'), {
      wrapper: wrapper(['/?tab=usage']),
    });
    expect(result.current[0]).toBe('usage');
  });

  it('setValue writes a non-default value into the URL param', () => {
    const { result } = renderHook(
      () => {
        const [value, setValue] = useUrlState('tab', 'overview');
        const [params] = useSearchParams();
        return { value, setValue, params };
      },
      { wrapper: wrapper(['/']) }
    );

    act(() => {
      result.current.setValue('usage');
    });

    expect(result.current.value).toBe('usage');
    expect(result.current.params.get('tab')).toBe('usage');
  });

  it('setValue removes the param from the URL when set back to the default value', () => {
    const { result } = renderHook(
      () => {
        const [value, setValue] = useUrlState('tab', 'overview');
        const [params] = useSearchParams();
        return { value, setValue, params };
      },
      { wrapper: wrapper(['/?tab=usage']) }
    );

    act(() => {
      result.current.setValue('overview');
    });

    expect(result.current.value).toBe('overview');
    expect(result.current.params.has('tab')).toBe(false);
  });

  it('setValue removes the param when set to an empty string', () => {
    const { result } = renderHook(
      () => {
        const [, setValue] = useUrlState('tab', 'overview');
        const [params] = useSearchParams();
        return { setValue, params };
      },
      { wrapper: wrapper(['/?tab=usage']) }
    );

    act(() => {
      result.current.setValue('');
    });

    expect(result.current.params.has('tab')).toBe(false);
  });

  it('setValue accepts a functional updater based on the previous value', () => {
    const { result } = renderHook(
      () => {
        const [value, setValue] = useUrlState('tab', 'overview');
        return { value, setValue };
      },
      { wrapper: wrapper(['/?tab=usage']) }
    );

    act(() => {
      result.current.setValue((prev) => `${prev}-2`);
    });

    expect(result.current.value).toBe('usage-2');
  });
});

describe('useUrlNullableState', () => {
  it('returns null when the URL has no matching param', () => {
    const { result } = renderHook(() => useUrlNullableState('filter'), {
      wrapper: wrapper(['/']),
    });
    expect(result.current[0]).toBeNull();
  });

  it('reads the current value from the URL when the param is present', () => {
    const { result } = renderHook(() => useUrlNullableState('filter'), {
      wrapper: wrapper(['/?filter=openai']),
    });
    expect(result.current[0]).toBe('openai');
  });

  it('setValue writes a value into the URL param', () => {
    const { result } = renderHook(
      () => {
        const [value, setValue] = useUrlNullableState('filter');
        const [params] = useSearchParams();
        return { value, setValue, params };
      },
      { wrapper: wrapper(['/']) }
    );

    act(() => {
      result.current.setValue('openai');
    });

    expect(result.current.value).toBe('openai');
    expect(result.current.params.get('filter')).toBe('openai');
  });

  it('setValue(null) removes the param', () => {
    const { result } = renderHook(
      () => {
        const [, setValue] = useUrlNullableState('filter');
        const [params] = useSearchParams();
        return { setValue, params };
      },
      { wrapper: wrapper(['/?filter=openai']) }
    );

    act(() => {
      result.current.setValue(null);
    });

    expect(result.current.params.has('filter')).toBe(false);
  });

  it('setValue accepts a functional updater based on the previous value', () => {
    const { result } = renderHook(
      () => {
        const [value, setValue] = useUrlNullableState('filter');
        return { value, setValue };
      },
      { wrapper: wrapper(['/?filter=openai']) }
    );

    act(() => {
      result.current.setValue((prev) => (prev ? `${prev}!` : 'x'));
    });

    expect(result.current.value).toBe('openai!');
  });
});
