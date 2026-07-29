import * as React from 'react';
import { useSearchParams } from 'react-router';

/**
 * Sync a state value with a URL search parameter.
 * Returns [value, setValue] — identical API to useState, but the value
 * is persisted in the URL search params so it survives page refreshes
 * and can be shared via URL.
 */
/**
 * `NoInfer` on `defaultValue` is what makes this usable.
 *
 * Without it, `useUrlState('tab', 'overview')` infers `T` as the literal
 * `'overview'`, so the returned setter accepts only that one string and every
 * call site that actually changes the value fails to typecheck. Blocking
 * inference at that position lets `T` fall back to `string`, while a caller
 * who wants a narrow union still gets it by passing the type argument
 * explicitly: `useUrlState<'a' | 'b'>('mode', 'a')`.
 */
export function useUrlState<T extends string = string>(
  key: string,
  defaultValue: NoInfer<T>
): [T, (value: T | ((prev: T) => T)) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlValue = searchParams.get(key) as T | null;
  const value = urlValue ?? defaultValue;

  const setValue = React.useCallback(
    (updater: T | ((prev: T) => T)) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const newVal = typeof updater === 'function' ? (updater as (prev: T) => T)(value) : updater;
        if (newVal === defaultValue || newVal === '' || newVal === null) {
          next.delete(key);
        } else {
          next.set(key, newVal);
        }
        return next;
      }, { replace: true });
    },
    [key, defaultValue, value, setSearchParams]
  );

  return [value, setValue];
}

/**
 * Sync a nullable state value (e.g. optional filter) with a URL search param.
 * Returns [value, setValue] where value is T | null.
 */
export function useUrlNullableState<T extends string>(
  key: string
): [T | null, (value: T | null | ((prev: T | null) => T | null)) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlValue = searchParams.get(key) as T | null;

  const setValue = React.useCallback(
    (updater: T | null | ((prev: T | null) => T | null)) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const newVal = typeof updater === 'function' ? (updater as (prev: T | null) => T | null)(urlValue) : updater;
        if (newVal === null || newVal === '') {
          next.delete(key);
        } else {
          next.set(key, newVal);
        }
        return next;
      }, { replace: true });
    },
    [key, urlValue, setSearchParams]
  );

  return [urlValue, setValue];
}
