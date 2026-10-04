/**
 * Universal inference resource identity.
 *
 * A provider credential is not the same thing as the capacity that credential
 * can consume. A single quota pool may cover many keys, models, or endpoints.
 * ResourceCell gives DMR-X a canonical schedulable identity for every
 * inference resource, including cloud APIs, local runtimes and device-local
 * WebGPU resources.
 */

export type ResourceKind =
  | 'llm'
  | 'vlm'
  | 'reasoning'
  | 'decision'
  | 'embedding'
  | 'reranking'
  | 'ocr'
  | 'document_understanding'
  | 'classification'
  | 'moderation'
  | 'stt'
  | 'tts'
  | 'audio_understanding'
  | 'audio_generation'
  | 'image_generation'
  | 'image_understanding'
  | 'video_generation'
  | 'video_understanding'
  | 'music_generation'
  | 'web_search'
  | 'web_fetch'
  | 'local_inference'
  | 'webgpu'
  | 'eeg'
  | 'bci'
  | 'biosignal';

export type EconomicUnit =
  | 'usd'
  | 'tokens'
  | 'requests'
  | 'minutes'
  | 'seconds'
  | 'characters'
  | 'credits'
  | 'neurons'
  | 'gpu_seconds'
  | 'gpu_hours'
  | 'jobs'
  | 'concurrency'
  | 'ip_requests';

export type FreeOfferKind =
  | 'recurring_free'
  | 'free_with_limits'
  | 'trial'
  | 'promo_credits'
  | 'startup_credits'
  | 'device_local'
  | 'keyless_public'
  | 'subscription_entitlement';

export interface ResourceCellIdentity {
  providerId: string;
  accountId?: string;
  organizationId?: string;
  projectId?: string;
  credentialId?: string;
  quotaPoolId: string;
  endpointId: string;
  modelId: string;
  resourceKind: ResourceKind;
}

export interface ResourceEconomics {
  unit: EconomicUnit;
  unitCost?: number;
  freeOffer?: FreeOfferKind;
  remaining?: number | null;
  limit?: number | null;
  resetAtMs?: number | null;
  expiresAtMs?: number | null;
  confidence: number;
}

export interface ResourcePolicy {
  dataRetention?: 'unknown' | 'no_retention' | 'provider_retained';
  trainingUse?: 'unknown' | 'not_used' | 'may_be_used';
  residency?: string;
  paymentMethodRequired?: boolean;
  productionAllowed?: boolean;
  requiresHumanEnrollment?: boolean;
}

export interface ResourceCell {
  identity: ResourceCellIdentity;
  capabilities: string[];
  modalities: string[];
  economics: ResourceEconomics[];
  policy?: ResourcePolicy;
  online: boolean;
  lastObservedAtMs: number;
  metadata?: Record<string, string | number | boolean>;
}
