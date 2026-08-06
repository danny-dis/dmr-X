import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin } from '../admin';
import { keys } from '../queryClient';

// ---------------------------------------------------------------------------
// Agent coding-tool integrations (Claude Code, Codex, Antigravity, OpenCode)
// ---------------------------------------------------------------------------
//
// All four integration pages share one settings-backed config blob — see
// `Admin.getAgentIntegrationConfig` — so a save on any one of them should
// invalidate the shared cache entry the others read from.

export interface AgentIntegrationConfig {
  claudeCode: Record<string, unknown> | null;
  codex: Record<string, unknown> | null;
  geminiCli: Record<string, unknown> | null;
  opencode: Record<string, unknown> | null;
}

export interface IntegrationTestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
}

export function useAgentIntegrationConfig() {
  return useQuery({
    queryKey: keys.integrations.config(),
    queryFn: () => Admin.getAgentIntegrationConfig() as Promise<AgentIntegrationConfig>,
  });
}

export function useUpdateAgentIntegrationConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tool,
      config,
    }: {
      tool: 'claudeCode' | 'codex' | 'gemini-cli' | 'opencode';
      config: Record<string, unknown>;
    }) => Admin.updateAgentIntegrationConfig(tool, config),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.integrations.config() }),
  });
}

/** One-off connection check, triggered by a "Test Connection" button — never
 * polled or run on mount. */
export function useTestIntegration() {
  return useMutation({
    mutationFn: (tool: 'claude-code' | 'codex' | 'gemini-cli' | 'opencode') =>
      Admin.testIntegration(tool) as Promise<IntegrationTestResult>,
  });
}
