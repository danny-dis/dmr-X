import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import crypto from 'node:crypto';
import os from 'node:os';
const cache = createNamespacedCache('workers');
export class WorkersService {
    heartbeatInterval = null;
    heartbeatTimeoutMs = 30_000;
    start() {
        this.heartbeatInterval = setInterval(() => this.checkStaleWorkers(), 10_000);
        logger.info('Workers service started');
    }
    stop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        logger.info('Workers service stopped');
    }
    register(input) {
        const db = getDb();
        const id = crypto.randomUUID();
        const hostname = os.hostname();
        const pid = process.pid;
        db.prepare(`
      INSERT INTO workers (id, name, type, status, hostname, pid, last_heartbeat_at)
      VALUES (?, ?, ?, 'active', ?, ?, datetime('now'))
    `).run(id, input.name, input.type || 'background', hostname, pid);
        logger.info(`Worker registered: ${input.name} (${id})`);
        return this.getById(id);
    }
    getById(id) {
        const db = getDb();
        const row = db.prepare('SELECT * FROM workers WHERE id = ?').get(id);
        return row ? this.mapRow(row) : null;
    }
    list() {
        const cached = cache.get('list');
        if (cached)
            return JSON.parse(cached);
        const db = getDb();
        const rows = db.prepare('SELECT * FROM workers ORDER BY created_at DESC').all();
        const workers = rows.map(r => this.mapRow(r));
        cache.set('list', JSON.stringify(workers), 10);
        return workers;
    }
    heartbeat(id) {
        const db = getDb();
        const result = db.prepare(`
      UPDATE workers SET last_heartbeat_at = datetime('now'), status = 'active'
      WHERE id = ? AND status != 'terminated'
    `).run(id);
        cache.delete('list');
        return result.changes > 0;
    }
    drain(id) {
        const db = getDb();
        db.prepare(`
      UPDATE workers SET status = 'draining' WHERE id = ? AND status = 'active'
    `).run(id);
        cache.delete('list');
        return this.getById(id);
    }
    resume(id) {
        const db = getDb();
        db.prepare(`
      UPDATE workers SET status = 'active' WHERE id = ? AND status = 'draining'
    `).run(id);
        cache.delete('list');
        return this.getById(id);
    }
    terminate(id) {
        const db = getDb();
        const result = db.prepare(`
      UPDATE workers SET status = 'terminated' WHERE id = ?
    `).run(id);
        cache.delete('list');
        return result.changes > 0;
    }
    assignJob(input) {
        const db = getDb();
        let worker;
        if (input.preferredWorkerId) {
            worker = db.prepare(`
        SELECT * FROM workers WHERE id = ? AND status = 'active'
      `).get(input.preferredWorkerId);
        }
        else {
            worker = db.prepare(`
        SELECT * FROM workers WHERE status = 'active'
        ORDER BY load ASC, jobs_processed ASC
        LIMIT 1
      `).get();
        }
        if (!worker) {
            logger.warn({ jobType: input.jobType }, 'No available worker for job assignment');
            return null;
        }
        const jobId = crypto.randomUUID();
        db.prepare(`
      INSERT INTO worker_jobs (id, worker_id, job_type, payload, status, started_at)
      VALUES (?, ?, ?, ?, 'running', datetime('now'))
    `).run(jobId, worker.id, input.jobType, input.payload);
        db.prepare(`
      UPDATE workers SET jobs_processed = jobs_processed + 1 WHERE id = ?
    `).run(worker.id);
        cache.delete('list');
        return {
            id: jobId,
            workerId: worker.id,
            jobType: input.jobType,
            payload: input.payload,
            status: 'running',
            startedAt: new Date().toISOString(),
            completedAt: null,
            error: null,
        };
    }
    completeJob(jobId, error) {
        const db = getDb();
        if (error) {
            db.prepare(`
        UPDATE worker_jobs SET status = 'failed', error = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(error, jobId);
        }
        else {
            db.prepare(`
        UPDATE worker_jobs SET status = 'completed', completed_at = datetime('now')
        WHERE id = ?
      `).run(jobId);
        }
    }
    listJobs(workerId, limit = 50) {
        const db = getDb();
        const query = workerId
            ? 'SELECT * FROM worker_jobs WHERE worker_id = ? ORDER BY started_at DESC LIMIT ?'
            : 'SELECT * FROM worker_jobs ORDER BY started_at DESC LIMIT ?';
        const rows = workerId
            ? db.prepare(query).all(workerId, limit)
            : db.prepare(query).all(limit);
        return rows.map(r => ({
            id: r.id,
            workerId: r.worker_id,
            jobType: r.job_type,
            payload: r.payload,
            status: r.status,
            startedAt: r.started_at,
            completedAt: r.completed_at,
            error: r.error,
        }));
    }
    checkStaleWorkers() {
        const db = getDb();
        const stale = db.prepare(`
      UPDATE workers SET status = 'unhealthy'
      WHERE status = 'active'
        AND last_heartbeat_at < datetime('now', '-' || ? || ' seconds')
    `).run(this.heartbeatTimeoutMs / 1000);
        if (stale.changes > 0) {
            logger.warn(`Marked ${stale.changes} workers as unhealthy (missed heartbeat)`);
            cache.delete('list');
        }
    }
    mapRow(row) {
        const lastBeat = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0;
        const alive = Date.now() - lastBeat < this.heartbeatTimeoutMs;
        return {
            id: row.id,
            name: row.name,
            type: row.type,
            status: row.status,
            hostname: row.hostname,
            pid: row.pid,
            load: row.load || 0,
            jobsProcessed: row.jobs_processed || 0,
            lastHeartbeatAt: row.last_heartbeat_at,
            createdAt: row.created_at,
            alive,
            draining: row.status === 'draining',
        };
    }
}
export const workersService = new WorkersService();
//# sourceMappingURL=workers.service.js.map