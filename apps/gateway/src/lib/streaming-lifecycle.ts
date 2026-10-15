import type { ServerResponse } from 'node:http';

/** Wait within the caller's absolute budget, even for uncooperative work. */
export function waitForStreamingWork<T>(work: Promise<T>, deadline: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error !== undefined) reject(error); else resolve(value as T);
    };
    const onAbort = () => finish(signal?.reason ?? new Error('Streaming caller disconnected'));
    work.then(value => finish(undefined, value), error => finish(error));
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    const remaining = deadline - Date.now();
    if (remaining <= 0) { finish(new Error('Streaming caller deadline exceeded')); return; }
    timer = setTimeout(() => finish(new Error('Streaming caller deadline exceeded')), remaining);
  });
}

/** Stop pulling upstream frames while the client socket is backpressured. */
export async function writeStreamingFrame(raw: ServerResponse, frame: string, deadline: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new Error('Streaming caller disconnected');
  if (raw.destroyed || raw.writableEnded) throw new Error('Streaming socket closed');
  if (raw.write(frame)) return;
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      raw.off('drain', onDrain); raw.off('close', onClose); raw.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (timer !== undefined) clearTimeout(timer);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onClose = () => onError(new Error('Streaming socket closed'));
    const onAbort = () => onError(signal?.reason ?? new Error('Streaming caller disconnected'));
    raw.once('drain', onDrain); raw.once('close', onClose); raw.once('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted || raw.destroyed || raw.writableEnded) { onAbort(); return; }
    const remaining = deadline - Date.now();
    if (remaining <= 0) { onError(new Error('Streaming caller deadline exceeded')); return; }
    timer = setTimeout(() => onError(new Error('Streaming caller deadline exceeded')), remaining);
  });
}
