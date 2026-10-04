import { createHash, timingSafeEqual } from 'node:crypto';

export interface AuthConfigInput {
  simpleKeys: string;
  fileKeyConfigs?: unknown;
  envKeyConfigsRaw?: string;
}

export interface BearerAuthPolicy {
  configured: boolean;
  malformed: boolean;
  keys: Array<{ key: string; allowedTools?: string[] }>;
}

export interface AuthenticationResult {
  authorized: boolean;
  principalId: string;
  allowedTools?: string[];
}

export function buildBearerAuthPolicy(input: AuthConfigInput): BearerAuthPolicy {
  const keys = input.simpleKeys.split(',').map((key) => key.trim()).filter(Boolean).map((key) => ({ key }));
  return { configured: keys.length > 0, malformed: false, keys };
}

export function authenticateBearer(
  req: { headers: Record<string, string | string[] | undefined> },
  policy: BearerAuthPolicy,
): AuthenticationResult {
  if (!policy.configured) return { authorized: true, principalId: 'anonymous' };
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return { authorized: false, principalId: 'unauthorized' };
  }
  const token = header.slice(7);
  const candidate = Buffer.from(token);
  for (const record of policy.keys) {
    const expected = Buffer.from(record.key);
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return {
        authorized: true,
        principalId: createHash('sha256').update(record.key).digest('hex'),
        allowedTools: record.allowedTools,
      };
    }
  }
  return { authorized: false, principalId: 'unauthorized' };
}
