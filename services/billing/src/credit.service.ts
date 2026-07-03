import crypto from 'node:crypto';

import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

export interface CreditBalance {
  tenantId: string;
  balanceCents: number;
  totalTopupCents: number;
  totalUsedCents: number;
}

export interface CreditTransaction {
  id: string;
  tenantId: string;
  type: 'topup' | 'usage' | 'refund' | 'adjustment';
  amountCents: number;
  balanceAfterCents: number;
  description: string | null;
  requestId: string | null;
  createdAt: string;
}

/**
 * Credit/Balance service for prepaid spending.
 * Enables users to top up credits and enforce hard spending limits.
 */
export class CreditService {
  /**
   * Get the current credit balance for a tenant.
   * Returns null if no credit account exists.
   */
  getBalance(tenantId: string): CreditBalance | null {
    const db = getDb();
    const row = db.prepare(
      `SELECT tenant_id, balance_cents, total_topup_cents, total_used_cents
       FROM credits WHERE tenant_id = ?`
    ).get(tenantId) as any;

    if (!row) return null;

    return {
      tenantId: row.tenant_id,
      balanceCents: row.balance_cents,
      totalTopupCents: row.total_topup_cents,
      totalUsedCents: row.total_used_cents,
    };
  }

  /**
   * Get or create a credit account for a tenant.
   */
  getOrCreateBalance(tenantId: string): CreditBalance {
    const existing = this.getBalance(tenantId);
    if (existing) return existing;

    const db = getDb();
    db.prepare(
      `INSERT INTO credits (tenant_id, balance_cents, total_topup_cents, total_used_cents)
       VALUES (?, 0, 0, 0)`
    ).run(tenantId);

    return { tenantId, balanceCents: 0, totalTopupCents: 0, totalUsedCents: 0 };
  }

  /**
   * Add credits to a tenant's balance (top-up).
   * Returns the new balance.
   */
  topUp(
    tenantId: string,
    amountCents: number,
    description?: string,
    adminKeyHash?: string,
  ): CreditBalance {
    if (amountCents <= 0) {
      throw new Error('Top-up amount must be positive');
    }

    const db = getDb();
    const balance = this.getOrCreateBalance(tenantId);
    const newBalance = balance.balanceCents + amountCents;

    db.transaction(() => {
      // Update balance
      db.prepare(
        `UPDATE credits SET
          balance_cents = ?,
          total_topup_cents = total_topup_cents + ?,
          updated_at = datetime('now')
        WHERE tenant_id = ?`
      ).run(newBalance, amountCents, tenantId);

      // Record transaction
      const txId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO credit_transactions (id, tenant_id, type, amount_cents, balance_after_cents, description, admin_key_hash)
         VALUES (?, ?, 'topup', ?, ?, ?, ?)`
      ).run(txId, tenantId, amountCents, newBalance, description || `Top-up $${(amountCents / 100).toFixed(2)}`, adminKeyHash || null);
    });

    logger.info(
      { tenantId, amountCents, newBalance },
      'Credits topped up'
    );

    return { tenantId, balanceCents: newBalance, totalTopupCents: balance.totalTopupCents + amountCents, totalUsedCents: balance.totalUsedCents };
  }

  /**
   * Deduct credits for usage. Returns true if sufficient balance.
   * Returns false if insufficient balance (does not deduct).
   */
  deductUsage(
    tenantId: string,
    amountCents: number,
    requestId?: string,
  ): boolean {
    if (amountCents <= 0) return true;

    const db = getDb();
    const balance = this.getBalance(tenantId);

    // No credit account = no spending limit (allow)
    if (!balance) return true;

    // Insufficient balance
    if (balance.balanceCents < amountCents) {
      logger.warn(
        { tenantId, required: amountCents, available: balance.balanceCents },
        'Insufficient credit balance'
      );
      return false;
    }

    const newBalance = balance.balanceCents - amountCents;

    db.transaction(() => {
      db.prepare(
        `UPDATE credits SET
          balance_cents = ?,
          total_used_cents = total_used_cents + ?,
          updated_at = datetime('now')
        WHERE tenant_id = ?`
      ).run(newBalance, amountCents, tenantId);

      const txId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO credit_transactions (id, tenant_id, type, amount_cents, balance_after_cents, request_id)
         VALUES (?, ?, 'usage', ?, ?, ?)`
      ).run(txId, tenantId, -amountCents, newBalance, requestId || null);
    });

    return true;
  }

  /**
   * Issue a refund.
   */
  refund(
    tenantId: string,
    amountCents: number,
    description: string,
    requestId?: string,
  ): CreditBalance {
    if (amountCents <= 0) throw new Error('Refund amount must be positive');

    const db = getDb();
    const balance = this.getOrCreateBalance(tenantId);
    const newBalance = balance.balanceCents + amountCents;

    db.transaction(() => {
      db.prepare(
        `UPDATE credits SET
          balance_cents = ?,
          updated_at = datetime('now')
        WHERE tenant_id = ?`
      ).run(newBalance, tenantId);

      const txId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO credit_transactions (id, tenant_id, type, amount_cents, balance_after_cents, description, request_id)
         VALUES (?, ?, 'refund', ?, ?, ?, ?)`
      ).run(txId, tenantId, amountCents, newBalance, description, requestId || null);
    });

    return { tenantId, balanceCents: newBalance, totalTopupCents: balance.totalTopupCents, totalUsedCents: balance.totalUsedCents };
  }

  /**
   * Get transaction history for a tenant.
   */
  getTransactions(
    tenantId: string,
    options?: { type?: string; limit?: number; offset?: number }
  ): CreditTransaction[] {
    const db = getDb();
    const conditions = ['tenant_id = ?'];
    const params: unknown[] = [tenantId];

    if (options?.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const rows = db.prepare(
      `SELECT id, tenant_id, type, amount_cents, balance_after_cents, description, request_id, created_at
       FROM credit_transactions
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as any[];

    return rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      type: row.type,
      amountCents: row.amount_cents,
      balanceAfterCents: row.balance_after_cents,
      description: row.description,
      requestId: row.request_id,
      createdAt: row.created_at,
    }));
  }

  /**
   * Check if a tenant has sufficient credits for an estimated cost.
   */
  checkSufficientCredits(tenantId: string, estimatedCostCents: number): {
    sufficient: boolean;
    balance: number;
    estimatedCost: number;
  } {
    const balance = this.getBalance(tenantId);
    if (!balance) return { sufficient: true, balance: -1, estimatedCost: estimatedCostCents };
    return {
      sufficient: balance.balanceCents >= estimatedCostCents,
      balance: balance.balanceCents,
      estimatedCost: estimatedCostCents,
    };
  }
}

export const creditService = new CreditService();
