import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAgentCard } from '../../services/mcp-server/src/a2a/agent-card.js';
import { authenticateA2ARequest, setA2ABearerPolicy } from '../../services/mcp-server/src/a2a/security.js';

afterEach(() => { setA2ABearerPolicy(null); vi.unstubAllEnvs(); });
describe('A2A advertised runtime authentication', () => {
  it('advertises configured listener bearer policy even when no key is present in env', () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('DMRX_MCP_API_KEY', ''); vi.stubEnv('DMRX_A2A_API_KEY', '');
    setA2ABearerPolicy({ configured: true, malformed: false, keys: [{ key: 'fixture-out-of-band' }] });
    expect(authenticateA2ARequest({}).ok).toBe(false);
    const card = buildAgentCard({}, []);
    expect(card.securityRequirements).toEqual([{ schemes: { httpBearer: { list: [] } } }]);
    expect(card.securitySchemes?.httpBearer).toBeDefined();
    expect(JSON.stringify(card)).not.toContain('fixture-out-of-band');
  });
  it('advertises bearer auth when the require-auth flag is false but a configured policy still enforces it', () => {
    vi.stubEnv('DMRX_A2A_REQUIRE_AUTH', 'false');
    setA2ABearerPolicy({ configured: true, malformed: false, keys: [{ key: 'fixture-out-of-band' }] });
    expect(authenticateA2ARequest({}).ok).toBe(false);
    expect(buildAgentCard({}, []).securityRequirements).toEqual([{ schemes: { httpBearer: { list: [] } } }]);
  });
});
