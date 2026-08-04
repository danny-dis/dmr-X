import { describe, it, expect } from 'vitest';

import {
  parsePolicy,
  RBACPolicyEngine,
  PREDEFINED_POLICIES,
  type AuthorizationRequest,
  type PolicyRule,
} from '../../services/policy/src/rbac.js';

describe('rbac parsePolicy', () => {
  it('parses a fully-specified permit policy', () => {
    const policy = parsePolicy(`
      permit(
        principal == Role::"admin",
        action == Action::"dmrx_bash",
        resource == Resource::"server"
      );
    `);
    expect(policy.effect).toBe('permit');
    expect(policy.principal).toEqual({ type: 'role', id: 'admin' });
    expect(policy.action).toEqual({ type: 'tool', id: 'dmrx_bash' });
    expect(policy.resource).toEqual({ type: 'tool', id: 'server' });
  });

  it('parses bare action/resource as explicit wildcards (ADMIN_FULL_ACCESS intent)', () => {
    const policy = parsePolicy(PREDEFINED_POLICIES.ADMIN_FULL_ACCESS);
    expect(policy.effect).toBe('permit');
    expect(policy.principal.id).toBe('admin');
    expect(policy.action.id).toBe('*');
    expect(policy.resource.id).toBe('*');
  });

  it('throws on a missing principal clause instead of defaulting to wildcard', () => {
    expect(() => parsePolicy('permit(action == Action::"dmrx_bash", resource);')).toThrow(
      /missing principal/,
    );
  });

  it('throws on a missing action clause instead of defaulting to wildcard', () => {
    expect(() => parsePolicy('permit(principal == Role::"user", resource);')).toThrow(
      /missing action/,
    );
  });

  it('throws on != negation (cannot be represented safely)', () => {
    expect(() => parsePolicy(PREDEFINED_POLICIES.DENY_BASH_NON_ADMIN)).toThrow(/!=/);
  });

  it('throws on in [...] list syntax (cannot be represented)', () => {
    expect(() => parsePolicy(PREDEFINED_POLICIES.USER_READ_ONLY)).toThrow(/in \[/);
  });

  it('throws on non-policy input', () => {
    expect(() => parsePolicy('this is not a policy')).toThrow(/permit|deny/);
  });

  it('loadPolicies skips unparseable policies instead of granting wildcards', () => {
    const engine = new RBACPolicyEngine({ enabled: true });
    engine.loadPolicies([
      PREDEFINED_POLICIES.USER_READ_ONLY, // previously became a wildcard grant
      PREDEFINED_POLICIES.ADMIN_FULL_ACCESS, // valid
    ]);
    expect(engine.getPolicies()).toHaveLength(1);
    expect(engine.getPolicies()[0].action.id).toBe('*');
  });
});

describe('rbac ip_in_cidr condition', () => {
  function makeEngine(cidr: string, value: string): RBACPolicyEngine {
    const engine = new RBACPolicyEngine({ enabled: true });
    const policy: PolicyRule = {
      id: 'p1',
      effect: 'permit',
      principal: { type: 'user', id: 'alice' },
      action: { type: 'tool', id: 'x' },
      resource: { type: 'tool', id: 'y' },
      conditions: [{ type: 'ip_in_cidr', key: 'sourceIp', value: cidr }],
    };
    engine.addPolicy(policy);
    return engine;
  }

  function request(ip: string): AuthorizationRequest {
    return {
      principal: { type: 'user', id: 'alice' },
      action: { type: 'tool', id: 'x' },
      resource: { type: 'tool', id: 'y' },
      context: { sourceIp: ip },
    };
  }

  it('allows IPv4 address inside the subnet', () => {
    expect(makeEngine('10.0.0.0/24', '10.0.0.5').authorize(request('10.0.0.5')).allowed).toBe(true);
  });

  it('denies IPv4 address outside the subnet', () => {
    expect(makeEngine('10.0.0.0/24', '10.0.1.5').authorize(request('10.0.1.5')).allowed).toBe(false);
  });

  it('allows every address for /0', () => {
    expect(makeEngine('0.0.0.0/0', '8.8.8.8').authorize(request('8.8.8.8')).allowed).toBe(true);
  });

  it('handles exact /32', () => {
    expect(makeEngine('192.168.1.1/32', '192.168.1.1').authorize(request('192.168.1.1')).allowed).toBe(true);
    expect(makeEngine('192.168.1.1/32', '192.168.1.2').authorize(request('192.168.1.2')).allowed).toBe(false);
  });

  it('rejects an out-of-range prefix length', () => {
    expect(makeEngine('10.0.0.0/33', '10.0.0.5').authorize(request('10.0.0.5')).allowed).toBe(false);
  });

  it('supports IPv6 CIDR matching', () => {
    expect(makeEngine('2001:db8::/32', '2001:db8::1').authorize(request('2001:db8::1')).allowed).toBe(true);
    expect(makeEngine('2001:db8::/32', '2001:db9::1').authorize(request('2001:db9::1')).allowed).toBe(false);
  });

  it('supports IPv6 compressed :: and exact /128', () => {
    expect(makeEngine('2001:db8:0:0:0:0:0:1/128', '2001:db8::1').authorize(request('2001:db8::1')).allowed).toBe(true);
    expect(makeEngine('2001:db8::/0', 'fe80::1').authorize(request('fe80::1')).allowed).toBe(true);
  });

  it('rejects mixed IPv4/IPv6 comparisons', () => {
    expect(makeEngine('10.0.0.0/8', '2001:db8::1').authorize(request('2001:db8::1')).allowed).toBe(false);
  });

  it('rejects malformed CIDR input', () => {
    expect(makeEngine('10.0.0.0', '10.0.0.5').authorize(request('10.0.0.5')).allowed).toBe(false);
    expect(makeEngine('10.0.0.0/', '10.0.0.5').authorize(request('10.0.0.5')).allowed).toBe(false);
    expect(makeEngine('10.0.0.0/abc', '10.0.0.5').authorize(request('10.0.0.5')).allowed).toBe(false);
  });
});
