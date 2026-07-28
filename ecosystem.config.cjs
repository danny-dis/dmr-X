/**
 * PM2 supervisor for DMR-X.
 *
 * ONE app on purpose. The gateway owns its companions: `startCompanionServices()`
 * spawns the MCP + A2A sidecar (:3100) and G0DM0D3 (:7860) as child processes,
 * and both spawn paths health-check their port first and adopt an existing
 * server instead of starting a second one. Declaring separate PM2 apps for them
 * would race that adoption logic and produce exactly the duplicate processes
 * this config exists to prevent.
 *
 *   pm2 start ecosystem.config.cjs     # start (idempotent — restarts if running)
 *   pm2 stop dmrx-gateway              # graceful stop, tears down both children
 *   pm2 logs dmrx-gateway              # follow
 *   pm2 save                           # persist for `pm2 resurrect` at logon
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * Parse the repo `.env` so its values can be passed to PM2 explicitly.
 *
 * This replaces the `env -u MISTRAL_API_KEY -u GOOGLE_API_KEY -u OPENROUTER_API_KEY`
 * prefix the gateway used to be launched with. That prefix existed because Bun
 * does not let `.env` override variables already present in the environment, so
 * a stale key exported in a shell would silently shadow the real one in `.env`.
 * Values set here take precedence over whatever the PM2 daemon inherited, which
 * achieves the same result without an `env.exe` wrapper process in between —
 * and that matters, because a wrapper on Windows does not reliably forward
 * SIGTERM, which would skip the gateway's graceful shutdown and orphan the very
 * children we are trying to keep supervised.
 *
 * No secrets live in this file; it reads them at load time.
 */
function readDotEnv(file) {
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return out; // no .env — rely on the ambient environment
  }
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const root = __dirname;
const bunExe =
  process.env.DMRX_BUN_PATH ||
  path.join(process.env.USERPROFILE || process.env.HOME || '', '.bun', 'bin', 'bun.exe');

module.exports = {
  apps: [
    {
      name: 'dmrx-gateway',
      script: 'apps/gateway/src/main.ts',
      interpreter: bunExe,
      cwd: root,

      // Fork, never cluster: a single SQLite writer and a single bound port.
      exec_mode: 'fork',
      instances: 1,

      autorestart: true,
      watch: false,

      // Restart policy. `min_uptime` + `max_restarts` mean a genuinely broken
      // build stops instead of spinning forever; exponential backoff keeps a
      // crash loop from hammering providers on every boot.
      min_uptime: '30s',
      max_restarts: 10,
      exp_backoff_restart_delay: 1000,

      // The shutdown path closes the HTTP server, flushes SQLite, and tears
      // down the MCP sidecar and G0DM0D3. PM2's 1600ms default would SIGKILL
      // partway through and orphan those children.
      kill_timeout: 20000,

      // Kill the whole process tree, so a force-kill cannot strand the sidecar
      // or G0DM0D3's three-deep `bun x tsx` chain.
      treekill: true,

      env: {
        ...readDotEnv(path.join(root, '.env')),
        DMRX_GODMODE_STRICT: 'false',
        NODE_ENV: process.env.NODE_ENV || 'development',
      },

      out_file: path.join(root, '.dmrx-data', 'logs', 'gateway-out.log'),
      error_file: path.join(root, '.dmrx-data', 'logs', 'gateway-err.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
