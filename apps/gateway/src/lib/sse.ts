/**
 * Write a Server-Sent Events frame to a Fastify reply's raw socket.
 * Shared by the gateway's streaming route handlers.
 */
export function writeSSE(
  reply: { raw: { write: (data: string) => void } },
  event: string,
  data: unknown,
): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
