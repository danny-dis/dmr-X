import type { StreamChunk, TokenStreamChunk, DoneStreamChunk } from '@dmr-x/core';

export function createOpenAISSEIterator(
  response: Response
): AsyncIterable<StreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is null');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let index = 0;

  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<StreamChunk>> {
          while (true) {
            // Check buffer for complete lines
            const newlineIndex = buffer.indexOf('\n');
            if (newlineIndex >= 0) {
              const line = buffer.slice(0, newlineIndex).trim();
              buffer = buffer.slice(newlineIndex + 1);

              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  return {
                    done: false,
                    value: {
                      type: 'done',
                      data: {},
                      index: index++,
                    } as DoneStreamChunk,
                  };
                }

                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta;

                  if (delta) {
                    return {
                      done: false,
                      value: {
                        type: 'token',
                        data: {
                          content: delta.content,
                          tool_calls: delta.tool_calls,
                          role: delta.role,
                        },
                        index: index++,
                      } as TokenStreamChunk,
                    };
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
              continue;
            }

            // Read more data
            const { done, value } = await reader.read();
            if (done) {
              return { done: true, value: undefined };
            }
            buffer += decoder.decode(value, { stream: true });
          }
        },
      };
    },
  };
}

export async function* createSSESerializer(
  chunks: AsyncIterable<StreamChunk>
): AsyncGenerator<string> {
  for await (const chunk of chunks) {
    if (chunk.type === 'token') {
      yield `data: ${JSON.stringify(chunk.data)}\n\n`;
    } else if (chunk.type === 'done') {
      yield 'data: [DONE]\n\n';
    }
  }
}
