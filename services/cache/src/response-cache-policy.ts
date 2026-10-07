/** Deterministic acceptance, not a claim that an answer is semantically correct. */
export function isCacheableChatResponse(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const value = response as Record<string, any>;
  if (value.error) return false;
  const complete = (reason: unknown) => reason === undefined || reason === 'stop' || reason === 'end_turn' || reason === 'STOP';
  const hasText = (message: any) => message && !message.refusal && !message.function_call &&
    !message.tool_calls?.length && typeof message.content === 'string' && message.content.trim().length > 0;
  if (Array.isArray(value.choices)) {
    return value.choices.length > 0 && value.choices.every((choice: any) =>
      choice && typeof choice === 'object' && complete(choice.finish_reason) && hasText(choice.message));
  }
  if (value.message) return complete(value.finishReason) && hasText(value.message);
  if (Array.isArray(value.content)) {
    return complete(value.stop_reason) && value.content.every((part: any) => part && typeof part === 'object') &&
      !value.content.some((part: any) => part.type === 'tool_use') &&
      value.content.some((part: any) => part.type === 'text' && typeof part.text === 'string' && part.text.trim());
  }
  return false;
}
