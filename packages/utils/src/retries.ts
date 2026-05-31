/**
 * Ported from OpenRouter SDK's retries.ts with adaptations for DMR-X.
 *
 * Provides fetch-specific retry with exponential backoff, jitter,
 * retry-after header parsing, and status-code-based retryable detection.
 *
 * Shared types (BackoffStrategy, RetryConfig, PermanentError, TemporaryError)
 * are re-exported from the canonical retry.ts module.
 */

import { isConnectionError, isTimeoutError } from "./error-classifiers.js";
import {
  type BackoffStrategy,
  type RetryConfig,
  PermanentError,
  TemporaryError,
} from "./retry.js";

// Re-export shared types for backward compatibility
export {
  type BackoffStrategy,
  type RetryConfig,
  PermanentError,
  TemporaryError,
};

const defaultBackoff: BackoffStrategy = {
  initialInterval: 500,
  maxInterval: 60000,
  exponent: 1.5,
  maxElapsedTime: 3600000,
};

export async function retry(
  fetchFn: () => Promise<Response>,
  options: {
    config: RetryConfig;
    statusCodes: string[];
  },
): Promise<Response> {
  switch (options.config.strategy) {
    case "backoff":
      return retryBackoff(
        wrapFetcher(fetchFn, {
          statusCodes: options.statusCodes,
          retryConnectionErrors: !!options.config.retryConnectionErrors,
        }),
        options.config.backoff ?? defaultBackoff,
      );
    default:
      return await fetchFn();
  }
}

function wrapFetcher(
  fn: () => Promise<Response>,
  options: {
    statusCodes: string[];
    retryConnectionErrors: boolean;
  },
): () => Promise<Response> {
  return async () => {
    try {
      const res = await fn();
      if (isRetryableResponse(res, options.statusCodes)) {
        throw new TemporaryError(
          "Response failed with retryable status code",
          res,
        );
      }

      return res;
    } catch (err: unknown) {
      if (err instanceof TemporaryError) {
        throw err;
      }

      if (
        options.retryConnectionErrors &&
        (isTimeoutError(err) || isConnectionError(err))
      ) {
        throw err;
      }

      throw new PermanentError("Permanent error", { cause: err });
    }
  };
}

const codeRangeRE = new RegExp("^[0-9]xx$", "i");

function isRetryableResponse(res: Response, statusCodes: string[]): boolean {
  const actual = `${res.status}`;

  return statusCodes.some((code) => {
    if (!codeRangeRE.test(code)) {
      return code === actual;
    }

    const expectFamily = code.charAt(0);
    if (!expectFamily) {
      throw new Error("Invalid status code range");
    }

    const actualFamily = actual.charAt(0);
    if (!actualFamily) {
      throw new Error(`Invalid response status code: ${actual}`);
    }

    return actualFamily === expectFamily;
  });
}

async function retryBackoff(
  fn: () => Promise<Response>,
  strategy: BackoffStrategy,
): Promise<Response> {
  const { maxElapsedTime, initialInterval, exponent, maxInterval } = strategy;

  const start = Date.now();
  let x = 0;

  while (true) {
    try {
      const res = await fn();
      return res;
    } catch (err: unknown) {
      if (err instanceof PermanentError) {
        throw err.cause;
      }
      const elapsed = Date.now() - start;
      if (elapsed > maxElapsedTime) {
        if (err instanceof TemporaryError) {
          return err.response;
        }

        throw err;
      }

      let retryInterval = 0;
      if (err instanceof TemporaryError) {
        retryInterval = retryIntervalFromResponse(err.response);
      }

      if (retryInterval <= 0) {
        retryInterval =
          initialInterval * Math.pow(x, exponent) + Math.random() * 1000;
      }

      const d = Math.min(retryInterval, maxInterval);

      await delay(d);
      x++;
    }
  }
}

function retryIntervalFromResponse(res: Response): number {
  const retryVal = res.headers.get("retry-after") || "";
  if (!retryVal) {
    return 0;
  }

  const parsedNumber = Number(retryVal);
  if (Number.isInteger(parsedNumber)) {
    return parsedNumber * 1000;
  }

  const parsedDate = Date.parse(retryVal);
  if (Number.isInteger(parsedDate)) {
    const deltaMS = parsedDate - Date.now();
    return deltaMS > 0 ? Math.ceil(deltaMS) : 0;
  }

  return 0;
}

async function delay(delay: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delay));
}
