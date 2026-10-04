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
  const keys: Array<{ key: string; allowedTools?: string[] }> = [];
  let malformed = false;
  let sourcePresent = false;

  const rawSimple = typeof input.simpleKeys === 'string' ? input.simpleKeys : '';
  if (rawSimple.trim().length > 0) sourcePresent = true;
  for (const key of rawSimple.split(',').map((k) => k.trim()).filter(Boolean)) {
    keys.push({ key });
  }

  if (input.fileKeyConfigs !== undefined) {
    sourcePresent = true;
    const parsed = parseKeyRecordList(input.fileKeyConfigs);
    if (parsed.malformed) malformed = true;
    else keys.push(...parsed.keys);
  }

  if (input.envKeyConfigsRaw !== undefined) {
    const raw = input.envKeyConfigsRaw;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      sourcePresent = true;
      const parsed = parseEnvKeyConfigs(raw);
      if (parsed.malformed) malformed = true;
      else keys.push(...parsed.keys);
    } else if (typeof raw === 'string') {
      // Empty string is the same as "not configured" (matches simpleKeys '').
    } else {
      sourcePresent = true;
      malformed = true;
    }
  }

  if (malformed) return { configured: true, malformed: true, keys: [] };
  void sourcePresent;
  return { configured: keys.length > 0, malformed: false, keys };
}

function isValidKeyRecord(entry: unknown): entry is { key: string; allowedTools?: string[] } {
  if (!entry || typeof entry !== 'object') return false;
  const rec = entry as Record<string, unknown>;
  if (typeof rec.key !== 'string' || rec.key.length === 0) return false;
  if (rec.allowedTools === undefined) return true;
  if (!Array.isArray(rec.allowedTools)) return false;
  return rec.allowedTools.every((t) => typeof t === 'string');
}

function toImmutableRecord(entry: { key: string; allowedTools?: string[] }): { key: string; allowedTools?: string[] } {
  return entry.allowedTools === undefined ? { key: entry.key } : { key: entry.key, allowedTools: [...entry.allowedTools] };
}

function parseKeyRecordList(value: unknown): { keys: Array<{ key: string; allowedTools?: string[] }>; malformed: boolean } {
  if (!Array.isArray(value)) return { keys: [], malformed: true };
  const keys: Array<{ key: string; allowedTools?: string[] }> = [];
  for (const entry of value) {
    if (!isValidKeyRecord(entry)) return { keys: [], malformed: true };
    keys.push(toImmutableRecord(entry));
  }
  return { keys, malformed: false };
}

function parseEnvKeyConfigs(raw: string): { keys: Array<{ key: string; allowedTools?: string[] }>; malformed: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { keys: [], malformed: true };
  }
  return parseKeyRecordList(parsed);
}

export function authenticateBearer(
  req: { headers: Record<string, string | string[] | undefined> },
  policy: BearerAuthPolicy,
): AuthenticationResult {
  // Fail closed: a malformed configured source denies every request.
  if (policy.malformed) return { authorized: false, principalId: 'unauthorized' };
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
        allowedTools: record.allowedTools === undefined ? undefined : [...record.allowedTools],
      };
    }
  }
  return { authorized: false, principalId: 'unauthorized' };
}
