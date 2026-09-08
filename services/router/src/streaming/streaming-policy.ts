// services/router/src/streaming/streaming-policy.ts
export interface DisconnectInfo {
  ttftMs: number | null;
  bytesReceived: number;
}

export interface OutputReservation {
  reserved: number;
  estimated: number;
}

export class StreamingPolicy {
  classifyDisconnect(info: DisconnectInfo): 'retryable' | 'non-retryable' {
    if (info.ttftMs === null && info.bytesReceived === 0) {
      return 'retryable';
    }
    return 'non-retryable';
  }

  reserveOutput(params: { maxTokens: number; estimatedOutputTokens: number }): OutputReservation {
    return {
      reserved: params.maxTokens,
      estimated: params.estimatedOutputTokens,
    };
  }

  shouldRetryDisconnect(info: DisconnectInfo): boolean {
    return this.classifyDisconnect(info) === 'retryable';
  }
}