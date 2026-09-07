/**
 * Free-provider catalog service — Phase 5 of the free inference control plane.
 *
 * Provides a queryable catalog of free-tier providers with published limits,
 * eligibility classification, and an observation-driven confidence model. The
 * catalog is the source of truth for `free_only` mode: it answers "is this
 * provider+model free?" and "how confident are we?" before the quota layer
 * ever consults live headers.
 *
 * See docs/DMRX-FREE-PROVIDER-RATE-CATALOG.md.
 */

import { readFileSync } from 'node:fs';
import {
  QuotaScope,
  ReplenishmentModel,
  QuotaUnit,
} from './quota-dimensions.js';

// ---------------------------------------------------------------------------
// Catalog record
// ---------------------------------------------------------------------------

export type FreeEligibility = 'free' | 'free_with_limits' | 'paid' | 'unknown';

export type CatalogStatus =
  | 'discovered'
  | 'verified'
  | 'active'
  | 'observed'
  | 'reconciled'
  | 'stale';

export interface CatalogRecord {
  providerId: string;
  modelId: string;
  endpoint: string;
  plan: string;
  freeEligibility: FreeEligibility;
  publishedLimits: Record<string, number>;
  quotaDimensions: QuotaUnit[];
  scope: QuotaScope;
  resetSemantics: ReplenishmentModel;
  sourceUrls: string[];
  sourceVerifiedAt: string; // ISO date
  catalogRevision: number;
  confidence: number;
  status: CatalogStatus;
}

// ---------------------------------------------------------------------------
// Policy for eligibility queries
// ---------------------------------------------------------------------------

export interface EligibilityPolicy {
  /** Only return providers with freeEligibility === 'free' (no limits). */
  strictFree: boolean;
  /** Minimum confidence threshold (defaults to 0.5). */
  minConfidence: number;
  /** Maximum age of source verification in ms (defaults to 7 days). */
  maxAgeMs: number;
}

export const DEFAULT_POLICY: EligibilityPolicy = {
  strictFree: false,
  minConfidence: 0.5,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// ---------------------------------------------------------------------------
// Eligibility result
// ---------------------------------------------------------------------------

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
  confidence: number;
  record?: CatalogRecord;
}

// ---------------------------------------------------------------------------
// Observation — real-world header data for confidence updates
// ---------------------------------------------------------------------------

export interface ProviderObservation {
  remainingRequests?: number;
  limitRequests?: number;
  remainingTokens?: number;
  limitTokens?: number;
  resetAtMs?: number;
  observedAtMs?: number;
  rateLimitHeaders?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Audit entry — tracks every mutation for a provider+model tuple
// ---------------------------------------------------------------------------

export interface CatalogAuditEntry {
  providerId: string;
  modelId: string;
  timestamp: number;
  action: 'load' | 'observation' | 'verification' | 'revision';
  previousConfidence?: number;
  newConfidence?: number;
  previousStatus?: CatalogStatus;
  newStatus?: CatalogStatus;
  note?: string;
}

// ---------------------------------------------------------------------------
// Verification job handle
// ---------------------------------------------------------------------------

export interface VerificationJob {
  stop: () => void;
  intervalMs: number;
}

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Compute confidence based on source verification age.
 *
 * - Within 24h: 0.9 – 1.0
 * - 1–7 days:   0.5 – 0.8
 * - >7 days:    < 0.5
 */
export function computeAgeConfidence(sourceVerifiedAt: string, nowMs: number = Date.now()): number {
  const verifiedMs = new Date(sourceVerifiedAt).getTime();
  if (Number.isNaN(verifiedMs)) return 0;

  const ageMs = nowMs - verifiedMs;
  if (ageMs < 0) return 1.0; // future-dated (clock skew); treat as fresh
  if (ageMs <= DAY_MS) {
    // Linearly decay from 1.0 → 0.9 over the first day
    return 1.0 - (ageMs / DAY_MS) * 0.1;
  }
  if (ageMs <= 7 * DAY_MS) {
    // Linearly decay from 0.9 → 0.5 over days 1–7
    const daysPastFirst = (ageMs - DAY_MS) / DAY_MS;
    return 0.9 - (daysPastFirst / 6) * 0.4;
  }
  // Beyond 7 days: continue decaying toward 0
  const weeksPastSeven = (ageMs - 7 * DAY_MS) / (7 * DAY_MS);
  return Math.max(0, 0.5 - weeksPastSeven * 0.5);
}

// ---------------------------------------------------------------------------
// FreeProviderCatalog
// ---------------------------------------------------------------------------

export class FreeProviderCatalog {
  private records: Map<string, CatalogRecord> = new Map();
  private auditLog: CatalogAuditEntry[] = [];
  private verificationJobs: Map<string, VerificationJob> = new Map();

  constructor(private nowMs: number = Date.now()) {}

  // -------------------------------------------------------------------------
  // Keying
  // -------------------------------------------------------------------------

  private static key(providerId: string, modelId: string): string {
    return `${providerId}::${modelId}`;
  }

  // -------------------------------------------------------------------------
  // loadCatalog — bulk-load from a JSON file
  // -------------------------------------------------------------------------

  loadCatalog(filePath: string): number {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as CatalogRecord[];
    return this.loadCatalogSync(data);
  }

  /**
   * Synchronous variant — used in tests and when the catalog is already
   * in memory (e.g. bundled with the service).
   */
  loadCatalogSync(records: CatalogRecord[]): number {
    let loaded = 0;
    for (const rec of records) {
      const k = FreeProviderCatalog.key(rec.providerId, rec.modelId);
      this.records.set(k, { ...rec });
      this.auditLog.push({
        providerId: rec.providerId,
        modelId: rec.modelId,
        timestamp: this.nowMs,
        action: 'load',
        newConfidence: rec.confidence,
        newStatus: rec.status,
      });
      loaded++;
    }
    return loaded;
  }

  // -------------------------------------------------------------------------
  // checkEligibility — is this provider+model free under the policy?
  // -------------------------------------------------------------------------

  checkEligibility(
    providerId: string,
    modelId: string,
    policy: Partial<EligibilityPolicy> = {},
  ): EligibilityResult {
    const merged = { ...DEFAULT_POLICY, ...policy };
    const k = FreeProviderCatalog.key(providerId, modelId);
    const rec = this.records.get(k);

    if (!rec) {
      return {
        eligible: false,
        reason: `No catalog record for ${providerId}/${modelId}`,
        confidence: 0,
      };
    }

    // Status check: must be active, observed, or reconciled to be eligible
    const admissibleStatuses: CatalogStatus[] = ['active', 'observed', 'reconciled', 'verified'];
    if (!admissibleStatuses.includes(rec.status)) {
      return {
        eligible: false,
        reason: `Record status '${rec.status}' is not admissible`,
        confidence: rec.confidence,
        record: rec,
      };
    }

    // Eligibility check
    if (rec.freeEligibility === 'paid') {
      return {
        eligible: false,
        reason: `${providerId}/${modelId} is a paid plan`,
        confidence: 1,
        record: rec,
      };
    }

    if (rec.freeEligibility === 'unknown') {
      return {
        eligible: false,
        reason: `Free eligibility unknown for ${providerId}/${modelId}`,
        confidence: 0,
        record: rec,
      };
    }

    if (merged.strictFree && rec.freeEligibility !== 'free') {
      return {
        eligible: false,
        reason: `Strict-free policy excludes '${rec.freeEligibility}'`,
        confidence: rec.confidence,
        record: rec,
      };
    }

    // Age-based confidence
    const ageConfidence = computeAgeConfidence(rec.sourceVerifiedAt, this.nowMs);
    const effectiveConfidence = Math.min(rec.confidence, ageConfidence);

    if (effectiveConfidence < merged.minConfidence) {
      return {
        eligible: false,
        reason: `Confidence ${effectiveConfidence.toFixed(2)} below threshold ${merged.minConfidence}`,
        confidence: effectiveConfidence,
        record: rec,
      };
    }

    return {
      eligible: true,
      reason: `Free-tier eligible (${rec.freeEligibility})`,
      confidence: effectiveConfidence,
      record: rec,
    };
  }

  // -------------------------------------------------------------------------
  // recordObservation — update a record from live header data
  // -------------------------------------------------------------------------

  recordObservation(
    providerId: string,
    modelId: string,
    observation: ProviderObservation,
  ): CatalogRecord | null {
    const k = FreeProviderCatalog.key(providerId, modelId);
    const rec = this.records.get(k);
    if (!rec) return null;

    const previousConfidence = rec.confidence;
    const previousStatus = rec.status;

    // Boost confidence slightly when live data corroborates published limits
    const boost = observation.rateLimitHeaders ? 0.05 : 0.02;
    const maxBoost = 1.0 - rec.confidence;
    rec.confidence = Math.min(1.0, rec.confidence + Math.min(boost, maxBoost));

    // Transition status: discovered/verified → observed upon first real data
    if (rec.status === 'discovered' || rec.status === 'verified' || rec.status === 'active') {
      rec.status = 'observed';
    }

    // If we have a fresh observation, update the verification timestamp
    if (observation.observedAtMs) {
      const hoursSinceObserved = (this.nowMs - observation.observedAtMs) / HOUR_MS;
      if (hoursSinceObserved < 24) {
        rec.sourceVerifiedAt = new Date(observation.observedAtMs).toISOString();
      }
    }

    this.auditLog.push({
      providerId,
      modelId,
      timestamp: this.nowMs,
      action: 'observation',
      previousConfidence,
      newConfidence: rec.confidence,
      previousStatus,
      newStatus: rec.status,
      note: 'Live observation recorded',
    });

    return rec;
  }

  // -------------------------------------------------------------------------
  // getRevisionHistory — audit trail for a provider+model
  // -------------------------------------------------------------------------

  getRevisionHistory(providerId: string, modelId: string): CatalogAuditEntry[] {
    return this.auditLog.filter(
      e => e.providerId === providerId && e.modelId === modelId,
    );
  }

  // -------------------------------------------------------------------------
  // startVerificationJob — periodic catalog-change detection
  // -------------------------------------------------------------------------

  startVerificationJob(
    intervalMs: number,
    providerId?: string,
    modelId?: string,
  ): VerificationJob {
    const targetKey = providerId && modelId
      ? FreeProviderCatalog.key(providerId, modelId)
      : null;

    let stopped = false;
    const tick = () => {
      if (stopped) return;
      this.runVerificationRound(targetKey);
      if (!stopped) {
        setTimeout(tick, intervalMs);
      }
    };

    // Kick off the first round after the interval
    setTimeout(tick, intervalMs);

    const job: VerificationJob = {
      stop: () => { stopped = true; },
      intervalMs,
    };

    const jobKey = targetKey ?? '__all__';
    // Stop any existing job for the same target
    const existing = this.verificationJobs.get(jobKey);
    existing?.stop();
    this.verificationJobs.set(jobKey, job);

    return job;
  }

  private runVerificationRound(targetKey: string | null): void {
    for (const [k, rec] of this.records) {
      if (targetKey && k !== targetKey) continue;

      const ageConfidence = computeAgeConfidence(rec.sourceVerifiedAt, this.nowMs);
      const previousConfidence = rec.confidence;
      const previousStatus = rec.status;

      // Re-compute effective confidence from source age
      const newConfidence = Math.min(rec.confidence, ageConfidence);

      if (newConfidence < 0.3 && rec.status !== 'stale') {
        rec.status = 'stale';
      } else if (newConfidence >= 0.5 && rec.status === 'stale') {
        rec.status = 'reconciled';
      }

      rec.confidence = newConfidence;

      this.auditLog.push({
        providerId: rec.providerId,
        modelId: rec.modelId,
        timestamp: this.nowMs,
        action: 'verification',
        previousConfidence,
        newConfidence,
        previousStatus,
        newStatus: rec.status,
      });
    }
  }

  // -------------------------------------------------------------------------
  // getFreeProviders — list all eligible free providers under a policy
  // -------------------------------------------------------------------------

  getFreeProviders(
    policy: Partial<EligibilityPolicy> = {},
  ): EligibilityResult[] {
    const results: EligibilityResult[] = [];
    for (const [k, rec] of this.records) {
      const [providerId, modelId] = k.split('::');
      const result = this.checkEligibility(providerId, modelId, policy);
      if (result.eligible) {
        results.push(result);
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Inspect helpers (useful for dashboards and tests)
  // -------------------------------------------------------------------------

  getRecord(providerId: string, modelId: string): CatalogRecord | undefined {
    return this.records.get(FreeProviderCatalog.key(providerId, modelId));
  }

  getAllRecords(): CatalogRecord[] {
    return Array.from(this.records.values());
  }

  getAuditLog(): CatalogAuditEntry[] {
    return [...this.auditLog];
  }
}