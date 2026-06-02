import { workersService } from './workers.service.js';
import { logger } from '@dmr-x/utils';
import crypto from 'node:crypto';

export interface TempWorkerConfig {
  name: string;
  taskType: string;
  idleTimeoutMs?: number;
  maxConcurrent?: number;
}

export interface TempWorker {
  id: string;
  workerId: string;
  name: string;
  taskType: string;
  status: 'spawning' | 'active' | 'idle' | 'terminating' | 'terminated';
  spawnTime: string;
  lastActivity: string;
  idleTimeoutMs: number;
  autoTerminate: boolean;
}

export class TempWorkerManager {
  private tempWorkers: Map<string, TempWorker> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.cleanupInterval = setInterval(() => this.cleanupIdle(), 5_000);
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  spawn(config: TempWorkerConfig): TempWorker {
    const id = crypto.randomUUID();
    const worker = workersService.register({
      name: `temp-${config.name}`,
      type: 'temporary',
    });

    const temp: TempWorker = {
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

  heartbeat(id: string): boolean {
    const temp = this.tempWorkers.get(id);
    if (!temp) return false;
    temp.lastActivity = new Date().toISOString();
    temp.status = 'active';
    workersService.heartbeat(temp.workerId);
    return true;
  }

  terminate(id: string): boolean {
    const temp = this.tempWorkers.get(id);
    if (!temp) return false;
    temp.status = 'terminating';
    workersService.terminate(temp.workerId);
    temp.status = 'terminated';
    this.tempWorkers.delete(id);
    logger.info(`Temporary worker terminated: ${temp.name} (${id})`);
    return true;
  }

  list(): TempWorker[] {
    return Array.from(this.tempWorkers.values());
  }

  private cleanupIdle(): void {
    const now = Date.now();
    for (const [id, temp] of this.tempWorkers) {
      if (!temp.autoTerminate) continue;
      const idle = now - new Date(temp.lastActivity).getTime();
      if (idle > temp.idleTimeoutMs) {
        this.terminate(id);
      }
    }
  }
}

export const tempWorkerManager = new TempWorkerManager();
