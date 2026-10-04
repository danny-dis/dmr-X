-- 084: Scheduled occurrence identity
-- Give every scheduled fire a deterministic occurrence key
-- (`<jobId>:<claimed next_run_at>`) so a crash between the gateway call and
-- schedule bookkeeping cannot refire the same occurrence, and duplicate
-- deliveries of one occurrence collapse to a single execution row.
--
-- The scheduler claims AND advances next_run_at in one atomic UPDATE, stamps
-- the claimed occurrence on the job row, and passes the key into the gateway
-- call (x-dmrx-occurrence-key) and the execution record. The partial unique
-- index keeps pre-084 rows (NULL key) untouched while rejecting a second
-- execution row for the same (tenant, instance, occurrence).
--
-- Delivery contract is at-least-once scheduling with at-most-once advancement:
-- a crash after the claim never refires the occurrence, but a gateway call
-- that was accepted before the crash may still have executed downstream.
-- Downstream consumers must treat the occurrence key as an idempotency key.
-- Exactly-once external side effects are NOT promised.

ALTER TABLE agent_scheduled_jobs
  ADD COLUMN last_occurrence_key TEXT;

ALTER TABLE agent_executions
  ADD COLUMN occurrence_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_executions_occurrence
ON agent_executions(tenant_id, agent_instance_id, occurrence_key)
WHERE occurrence_key IS NOT NULL;
