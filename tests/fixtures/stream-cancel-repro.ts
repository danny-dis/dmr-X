import { createOpenAISSEIterator } from '../../services/adapters/src/stream-normalizer.ts';
let unhandled = 0;
process.on('unhandledRejection', (reason) => {
  unhandled++;
  console.error('UNHANDLED_CANCEL', reason instanceof Error ? reason.name : typeof reason);
});
const abort = new AbortController();
const body = new ReadableStream<Uint8Array>({
  start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n')); },
});
const iterator = createOpenAISSEIterator(new Response(body), { signal: abort.signal })[Symbol.asyncIterator]();
await iterator.next();
abort.abort();
await iterator.return?.();
await new Promise((resolve) => setTimeout(resolve, 30));
process.exitCode = unhandled ? 1 : 0;
console.log(JSON.stringify({ unhandled }));
