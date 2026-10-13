import { beforeEach, describe, expect, it, vi } from 'vitest';
const registry = vi.hoisted(() => ({
  getInstance: vi.fn(), getDefinition: vi.fn(), canAccessDefinition: vi.fn(),
  transitionInstanceLifecycle: vi.fn(), touchInstance: vi.fn(),
}));
vi.mock('@dmr-x/agent-registry', () => ({ agentRegistryService: registry }));
vi.mock('@dmr-x/db', () => ({ getDb: vi.fn(() => { throw new Error('No DB needed for persistent fixture'); }) }));
vi.mock('@dmr-x/billing', () => ({ billingService: {} }));
vi.mock('@dmr-x/memory', () => ({ agentMemoryManager: {} }));
import { AgentRuntimeService } from '../../services/agent-runtime/src/agent-runtime.js';

beforeEach(() => {
  vi.clearAllMocks();
  const instance = { id: 'instance-1', agentDefinitionId: 'definition-1', tenantId: 'tenant-1',
    status: 'active', lifecycleState: 'ready', runtimeMode: 'persistent', lifecyclePolicy: {} };
  registry.getInstance.mockResolvedValue(instance);
  registry.transitionInstanceLifecycle.mockImplementation(async (_id, _tenant, state) => ({ ...instance, lifecycleState: state }));
  registry.getDefinition.mockResolvedValue(null); registry.canAccessDefinition.mockResolvedValue(false);
});
describe('Hosted runtime context validation before wake', () => {
  it('rejects an orphan without waking its durable instance', async () => {
    expect(await new AgentRuntimeService().loadContext('instance-1', 'tenant-1')).toBeNull();
    expect(registry.transitionInstanceLifecycle).not.toHaveBeenCalled();
    expect(registry.touchInstance).not.toHaveBeenCalled();
  });
  it('rejects a foreign inaccessible definition without waking its instance', async () => {
    registry.getDefinition.mockResolvedValue({ id: 'definition-1', tenantId: 'foreign-tenant' });
    expect(await new AgentRuntimeService().loadContext('instance-1', 'tenant-1')).toBeNull();
    expect(registry.canAccessDefinition).toHaveBeenCalledWith('definition-1', 'tenant-1', 'run');
    expect(registry.transitionInstanceLifecycle).not.toHaveBeenCalled();
  });
});
