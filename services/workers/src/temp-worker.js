import { workersService } from './workers.service.js';
import { logger } from '@dmr-x/utils';
import crypto from 'node:crypto';
export class TempWorkerManager {
    tempWorkers = new Map();
    cleanupInterval = null;
    start() {
        this.cleanupInterval = setInterval(() => this.cleanupIdle(), 5_000);
    }
    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
    spawn(config) {
        const id = crypto.randomUUID();
        const worker = workersService.register({
            name: `temp-${config.name}`,
            type: 'temporary',
        });
        const temp = {
            id,
            workerId: worker.id,
            name: config.name,
            taskType: config.taskType,
            status: 'active',
            spawnTime: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            idleTimeoutMs: config.idleTimeoutMs || 60_000,
            autoTerminate: true,
        };
        this.tempWorkers.set(id, temp);
        logger.info(`Temporary worker spawned: ${config.name} (${id})`);
        return temp;
    }
    heartbeat(id) {
        const temp = this.tempWorkers.get(id);
        if (!temp)
            return false;
        temp.lastActivity = new Date().toISOString();
        temp.status = 'active';
        workersService.heartbeat(temp.workerId);
        return true;
    }
    terminate(id) {
        const temp = this.tempWorkers.get(id);
        if (!temp)
            return false;
        temp.status = 'terminating';
        workersService.terminate(temp.workerId);
        temp.status = 'terminated';
        this.tempWorkers.delete(id);
        logger.info(`Temporary worker terminated: ${temp.name} (${id})`);
        return true;
    }
    list() {
        return Array.from(this.tempWorkers.values());
    }
    cleanupIdle() {
        const now = Date.now();
        for (const [id, temp] of this.tempWorkers) {
            if (!temp.autoTerminate)
                continue;
            const idle = now - new Date(temp.lastActivity).getTime();
            if (idle > temp.idleTimeoutMs) {
                this.terminate(id);
            }
        }
    }
}
export const tempWorkerManager = new TempWorkerManager();
//# sourceMappingURL=temp-worker.js.map