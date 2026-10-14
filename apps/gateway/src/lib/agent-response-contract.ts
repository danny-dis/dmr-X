/** Response-only projection of authoritative loop flags and conversation state. */
export function agentResponseContract(
  result: { budgetExceeded: boolean; runTimedOut?: boolean; awaitingApproval?: boolean },
  conversation: {
    status: 'in_progress' | 'completed' | 'error' | 'awaiting_approval' | 'interrupted';
    pendingToolCalls?: unknown[];
  },
) {
  // Budget stops currently leave the loop state completed; never expose that
  // as successful completion. Timeout is likewise authoritative over state.
  const status = result.budgetExceeded || result.runTimedOut
    ? 'interrupted'
    : result.awaitingApproval
      ? 'awaiting_approval'
      : conversation.status;
  return {
    status,
    ...(status === 'awaiting_approval' ? { pending_tool_calls: conversation.pendingToolCalls ?? [] } : {}),
    ...(result.budgetExceeded ? { budget_exceeded: true } : {}),
    ...(result.runTimedOut ? { run_timed_out: true } : {}),
  };
}

/** Persist success only for authoritative completion, not partial output. */
export function agentExecutionTelemetry(contract: ReturnType<typeof agentResponseContract>): {
  status: 'success' | 'error';
  error?: string;
} {
  if (contract.status === 'completed') return { status: 'success' };
  return {
    status: 'error',
    error: contract.budget_exceeded
      ? 'budget_exceeded'
      : contract.run_timed_out
        ? 'run_timeout'
        : contract.status,
  };
}
