export type Modality =
  | 'llm'
  | 'diffusion'
  | 'embedding'
  | 'audio_tts'
  | 'audio_stt'
  | 'audio_speech'
  | 'audio_transcription'
  | 'video'
  | 'music'
  | 'reranking'
  | 'moderation'
  | 'code_completion'
  | 'image_upscaling'
  | 'image_inpainting';

export type IntelligenceLayer = 'brain' | 'thinker' | 'executor' | 'worker' | 'temp_worker';

export type QualityTarget = 'frontier' | 'balanced' | 'economy';

// Maps API paths to modalities
export const MODALITY_ENDPOINTS: Record<string, Modality> = {
  '/v1/chat/completions': 'llm',
  '/v1/messages': 'llm',
  '/v1/completions': 'llm',
  '/v1/embeddings': 'embedding',
  '/v1/images/generations': 'diffusion',
  '/v1/images/upscale': 'image_upscaling',
  '/v1/images/inpaint': 'image_inpainting',
  '/v1/audio/speech': 'audio_tts',
  '/v1/audio/transcriptions': 'audio_stt',
  '/v1/video/generations': 'video',
  '/v1/music/generations': 'music',
  '/v1/rerank': 'reranking',
  '/v1/moderations': 'moderation',
};

// Fallback chains per modality (ordered by preference)
export const DEFAULT_FALLBACK_CHAINS: Record<Modality, string[]> = {
  llm: ['openai', 'anthropic', 'ollama'],
  diffusion: ['stability', 'replicate', 'openai'],
  embedding: ['openai', 'ollama'],
  audio_tts: ['elevenlabs', 'openai'],
  audio_stt: ['openai', 'deepgram'],
  audio_speech: ['openai', 'elevenlabs'],
  audio_transcription: ['openai', 'deepgram'],
  video: ['replicate', 'runway'],
  music: ['replicate', 'suno'],
  reranking: ['cohere', 'jina'],
  moderation: ['openai'],
  code_completion: ['openai', 'anthropic', 'ollama'],
  image_upscaling: ['stability', 'replicate'],
  image_inpainting: ['stability', 'replicate'],
};

// Timeout per modality (ms)
export const MODALITY_TIMEOUTS: Record<Modality, number> = {
  llm: 30000,
  diffusion: 120000,
  embedding: 10000,
  audio_tts: 30000,
  audio_stt: 60000,
  audio_speech: 30000,
  audio_transcription: 60000,
  video: 300000,
  music: 180000,
  reranking: 10000,
  moderation: 10000,
  code_completion: 15000,
  image_upscaling: 60000,
  image_inpainting: 120000,
};
