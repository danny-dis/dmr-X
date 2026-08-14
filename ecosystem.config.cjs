/**
 * PM2 — the single supervisor for DMR-X.
 *
 * Nothing else may supervise these processes. scripts/dmrx-alwayson.ps1 used to
 * run the packaged binary on the same port from a Task Scheduler job; running
 * both meant two gateways racing for :47113, one crash-looping forever while
 * duplicate companions piled up behind it. That script is retained only for
 * manual, PM2-less operation — never register it as a scheduled task.
 *
 * TWO apps, and the split is deliberate:
 *
 *   dmrx-gateway       the gateway, which owns its own companions.
 *                      `startCompanionServices()` spawns the MCP + A2A sidecar
 *                      (:3100) and G0DM0D3 (:7860); both spawn paths health-check
 *                      their port first and ADOPT a healthy server rather than
 *                      start a second one, and `reapStaleCompanions()` kills any
 *                      previous generation before binding. Declaring PM2 apps for
 *                      them would race that adoption logic and manufacture the
 *                      duplicates it exists to prevent.
 *
 *   dmrx-needle-router the Needle pre-router (:8011). A separate app because it
 *                      is a Python process with no such adoption logic, and the
 *                      gateway calls it over HTTP (see needlePreFilter.ts) rather
 *                      than spawning it.
 *
 *   pm2 start ecosystem.config.cjs     # start both (idempotent)
 *   pm2 stop all                       # graceful stop, tears down children too
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
      // Run bun as the script with the entrypoint as an argument, rather than
      // `script: main.ts` + `interpreter: bun.exe`.
      //
      // With the interpreter form, PM2 on Windows builds the child command
      // itself and repeatedly lost track of the resulting process: `pm2 list`
      // showed `pid 0 / waiting restart` with a restart counter climbing into
      // the dozens while a perfectly healthy gateway was still bound to the
      // port. Because PM2 believed the app was down it kept launching more,
      // and two generations then raced each other over the same SQLite file —
      // which is how admin writes silently vanished on restart.
      //
      // Invoking the executable directly keeps the spawned pid the one PM2
      // tracks, so its bookkeeping stays correct.
      script: bunExe,
      args: ['apps/gateway/src/main.ts'],
      interpreter: 'none',
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
      // partway through and orphan those children. The gateway's own in-process
      // flush deadline is 30s (SHUTDOWN_TIMEOUT_MS), so kill_timeout must exceed
      // it or PM2's treekill lands before the graceful flush completes.
      kill_timeout: 35000,

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

    {
      name: 'dmrx-needle-router',
      // run_clean.py, not server.py: it strips the Hermes venv out of sys.path
      // before importing anything. Without it `import needle` resolves into the
      // wrong environment and the service starts but never binds :8011.
      script: 'run_clean.py',
      cwd: path.join(root, 'services', 'needle-router'),
      interpreter: path.join(root, 'services', 'needle-router', '.venv', 'Scripts', 'python.exe'),

      exec_mode: 'fork',
      instances: 1,

      autorestart: true,
      watch: false,

      min_uptime: '30s',
      max_restarts: 10,
      exp_backoff_restart_delay: 1000,

      // uvicorn spawns workers; treekill stops them dying orphaned and holding
      // :8011 against the next start.
      kill_timeout: 10000,
      treekill: true,

      env: {
        // Belt and braces with run_clean.py. Hermes exports these globally, and
        // an inherited PYTHONPATH/PYTHONHOME re-contaminates the interpreter
        // before run_clean.py gets a chance to run — this is what
        // start-clean.bat was working around.
        PYTHONPATH: '',
        PYTHONHOME: '',
        PYTHONUNBUFFERED: '1',
      },

      out_file: path.join(root, '.dmrx-data', 'logs', 'needle-out.log'),
      error_file: path.join(root, '.dmrx-data', 'logs', 'needle-err.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
