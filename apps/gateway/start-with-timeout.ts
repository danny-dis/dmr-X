import { spawn } from 'node:child_process';
import http from 'node:http';

const PORTS = [47200, 47201, 47202, 47203];
const TIMEOUT_MS = 40_000;
const MAX_RETRIES = PORTS.length;

function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 2000 });
      req.on('response', (res) => {
        if (res.statusCode === 200) { res.resume(); return resolve(true); }
        res.resume();
        if (Date.now() < deadline) setTimeout(check, 800);
        else resolve(false);
      });
      req.on('error', () => {
        if (Date.now() < deadline) setTimeout(check, 800);
        else resolve(false);
      });
    };
    check();
  });
}

function killTree(pid: number) {
  try { process.kill(pid, 'SIGTERM'); } catch {
    // Best-effort only: the child may have already exited (ESRCH) between
    // the readiness check failing and this call, which is not an error here.
  }
}

async function main() {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const port = PORTS[attempt];
    const child = spawn(
      process.execPath,
      ['src/main.ts'],
      {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port) },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const log = (data: Buffer) => {
      if (data.toString().includes('DMR-X Gateway running') || data.toString().includes('Starting DMR-X Gateway')) {
        // pass through
      }
      process.stdout.write(data);
    };
    child.stdout.on('data', log);
    child.stderr.on('data', log);

    const ready = await waitForPort(port, TIMEOUT_MS);
    if (ready) {
      console.error(`[timeout-wrapper] Gateway healthy on :${port} (attempt ${attempt + 1})`);
      // hand off to parent so SIGINT tears it down
      process.on('SIGINT', () => { killTree(child.pid!); process.exit(0); });
      process.on('SIGTERM', () => { killTree(child.pid!); process.exit(0); });
      return;
    }

    console.error(`[timeout-wrapper] No response on :${port} after ${TIMEOUT_MS}ms — killing attempt ${attempt + 1}`);
    killTree(child.pid!);
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.error('[timeout-wrapper] All startup attempts failed');
  process.exit(1);
}

main().catch((err) => { console.error('[timeout-wrapper]', err); process.exit(1); });
