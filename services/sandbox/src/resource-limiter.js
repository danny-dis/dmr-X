import os from 'node:os';
export class ResourceLimiter {
    maxCpuPercent = 80;
    maxMemoryPercent = 80;
    maxConcurrentProcesses = 100;
    checkLimits() {
        const loadavg = os.loadavg();
        const cpuCount = os.cpus().length;
        const cpuPercent = (loadavg[0] / cpuCount) * 100;
        if (cpuPercent > this.maxCpuPercent) {
            return { ok: false, reason: `CPU usage too high: ${cpuPercent.toFixed(1)}%` };
        }
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedPercent = ((totalMem - freeMem) / totalMem) * 100;
        if (usedPercent > this.maxMemoryPercent) {
            return { ok: false, reason: `Memory usage too high: ${usedPercent.toFixed(1)}%` };
        }
        return { ok: true };
    }
    getResourceUsage() {
        const loadavg = os.loadavg();
        const cpuCount = os.cpus().length;
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        return {
            cpu: loadavg[0] / cpuCount,
            memory: (totalMem - freeMem) / totalMem,
            memoryUsed: totalMem - freeMem,
            memoryTotal: totalMem,
        };
    }
}
//# sourceMappingURL=resource-limiter.js.map