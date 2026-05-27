import { randomBytes, createHash } from 'node:crypto';

export function generateId(): string {
  return randomBytes(16).toString('hex');
}

export function generateRequestId(): string {
  return `req_${generateId()}`;
}

export function generateApiKey(): string {
  return `dmr-${randomBytes(32).toString('hex')}`;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
