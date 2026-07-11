export type CompressionEngineKind = 'headroom' | 'rtk' | 'caveman' | 'comment-strip' | 'auto';

export interface CompressionStage {
  name: string;
  engine: CompressionEngineKind;
  tokensIn: number;
  tokensOut: number;
  dropped: number;
  kept: number;
  outputSnippet: string;
}

export interface CompressionPreview {
  engine: CompressionEngineKind;
  resolvedEngines: CompressionEngineKind[];
  stages: CompressionStage[];
  input: string;
  output: string;
  originalTokens: number;
  compressedTokens: number;
  saved: number;
  ratio: number;
}
