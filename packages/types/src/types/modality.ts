export type Modality =
  | 'llm'
  | 'diffusion'
  | 'embedding'
  | 'audio_tts'
  | 'audio_stt'
  | 'audio_speech'
  | 'audio_transcription'
  | 'audio_separation'
  | 'audio_intelligence'
  | 'video'
  | 'video_analysis'
  | 'music'
  | 'reranking'
  | 'moderation'
  | 'code_completion'
  | 'ocr'
  | 'image_upscaling'
  | 'image_inpainting'
  | 'vision'
  | '3d';

export type IntelligenceLayer = 'brain' | 'thinker' | 'executor' | 'worker' | 'temp_worker';

/**
 * Capability tier — classifies models by their actual capability level.
 * Separate from IntelligenceLayer which indicates source (cloud/local/free).
 *
 * - orchestrator: Coordinates other models, meta-level reasoning
 * - brain: Best general intelligence (Opus, GPT-4/5, o3)
 * - thinker: Reasoning/thinking ability (DeepSeek R1, o3-mini)
 * - executor: General-purpose tasks (Sonnet, Gemini, Grok)
 * - specialist: Domain-specific narrow AI (Codestral, MiMo, v0)
 * - worker: Fast/cheap/simple tasks (mini, flash, haiku)
 * - temp_worker: Local/free tier models (further classified at runtime)
 */
export type CapabilityTier =
  | 'orchestrator'
  | 'brain'
  | 'thinker'
  | 'executor'
  | 'specialist'
  | 'worker'
  | 'temp_worker';

export type QualityTarget = 'frontier' | 'balanced' | 'economy';

// Maps API paths to modalities
export const MODALITY_ENDPOINTS: Record<string, Modality> = {
  '/v1/chat/completions': 'llm',
  '/v1/agentic/chat': 'llm',
  '/v1/tools/loop': 'llm',
  '/v1/messages': 'llm',
  '/v1/gemini/generateContent': 'llm',
  '/v1/completions': 'llm',
  '/v1/embeddings': 'embedding',
  '/v1/images/generations': 'diffusion',
  '/v1/images/upscale': 'image_upscaling',
  '/v1/images/inpaint': 'image_inpainting',
  '/v1/audio/speech': 'audio_tts',
  '/v1/audio/transcriptions': 'audio_stt',
  '/v1/audio/separate': 'audio_separation',
  '/v1/audio/diarize': 'audio_intelligence',
  '/v1/audio/emotion': 'audio_intelligence',
  '/v1/audio/identify-speaker': 'audio_intelligence',
  '/v1/video/generations': 'video',
  '/v1/video/analyze': 'video_analysis',
  '/v1/music/generations': 'music',
  '/v1/rerank': 'reranking',
  '/v1/moderations': 'moderation',
  '/v1/vision/detect': 'vision',
  '/v1/vision/segment': 'vision',
  '/v1/vision/classify': 'vision',
  '/v1/3d/generate': '3d',
  '/v1/ocr': 'ocr',
};

// Fallback chains per modality (ordered by preference)
export const DEFAULT_FALLBACK_CHAINS: Record<Modality, string[]> = {
  llm: ['openai', 'anthropic', 'ollama'],
  diffusion: ['stability', 'replicate', 'openai'],
  embedding: ['openai', 'ollama', 'voyage', 'nomic'],
  audio_tts: ['elevenlabs', 'openai'],
  audio_stt: ['openai', 'deepgram'],
  audio_speech: ['openai', 'elevenlabs'],
  audio_transcription: ['openai', 'deepgram'],
  audio_separation: ['demucs', 'audioshake', 'stemsplit'],
  audio_intelligence: ['deepgram', 'elevenlabs'],
  video: ['fal', 'runway', 'replicate', 'luma'],
  video_analysis: ['fal', 'replicate'],
  music: ['replicate', 'suno', 'stable-audio'],
  reranking: ['cohere', 'jina', 'voyage'],
  moderation: ['openai'],
  code_completion: ['openai', 'anthropic', 'ollama'],
  image_upscaling: ['stability', 'replicate'],
  image_inpainting: ['stability', 'replicate'],
  vision: ['ultralytics', 'huggingface', 'fal-ai'],
  ocr: ['paddleocr', 'tesseract', 'huggingface'],
  '3d': ['fal-ai', 'replicate', 'stability'],
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
  audio_separation: 180000, // Async: 1-3 min for stem separation
  audio_intelligence: 60000,
  video: 600000, // 10 min — video models can be slow (Sora 2, Veo 3.1)
  video_analysis: 300000, // 5 min — frame analysis + processing
  music: 180000,
  reranking: 10000,
  moderation: 10000,
  code_completion: 15000,
  image_upscaling: 60000,
  image_inpainting: 120000,
  vision: 30000, // Vision inference (detection, segmentation)
  ocr: 30000, // OCR processing
  '3d': 120000, // 3D generation (slower than images)
};

// Human-readable labels for modalities
export const MODALITY_LABELS: Record<Modality, string> = {
  llm: 'Large Language Model',
  diffusion: 'Image Generation',
  embedding: 'Embeddings',
  audio_tts: 'Text-to-Speech',
  audio_stt: 'Speech-to-Text',
  audio_speech: 'Speech Processing',
  audio_transcription: 'Transcription',
  audio_separation: 'Audio Source Separation',
  audio_intelligence: 'Audio Intelligence',
  video: 'Video Generation',
  video_analysis: 'Video Analysis',
  music: 'Music Generation',
  reranking: 'Reranking',
  moderation: 'Content Moderation',
  code_completion: 'Code Completion',
  image_upscaling: 'Image Upscaling',
  image_inpainting: 'Image Inpainting',
  vision: 'Vision (Detection/Segmentation)',
  ocr: 'Optical Character Recognition',
  '3d': '3D Generation',
};
