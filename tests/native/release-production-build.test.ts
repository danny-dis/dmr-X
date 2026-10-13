import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const workflow = Bun.YAML.parse(readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')) as {
  jobs: { release: { steps: Array<{ name?: string; env?: Record<string, string> }> } };
};

test('release compilation preserves production error policy in the executable', () => {
  const step = workflow.jobs.release.steps.find(entry => entry.name === 'Compile and package five platforms');
  expect(step).toBeDefined();
  const directory = mkdtempSync(join(tmpdir(), 'dmrx-release-env-test-'));
  try {
    const source = join(directory, 'probe.ts');
    const executable = join(directory, process.platform === 'win32' ? 'probe.exe' : 'probe');
    writeFileSync(source, "console.log(JSON.stringify({compiled:process.env.NODE_ENV,runtime:Reflect.get(process.env,'NODE_ENV')}));\n");
    const buildEnv = { ...process.env };
    delete buildEnv.NODE_ENV;
    if (step?.env?.NODE_ENV) buildEnv.NODE_ENV = step.env.NODE_ENV;
    const build = Bun.spawnSync({ cmd: [process.execPath, 'build', '--compile', source, '--outfile', executable], env: buildEnv, stdout: 'pipe', stderr: 'pipe' });
    expect(build.exitCode).toBe(0);
    const run = Bun.spawnSync({ cmd: [executable], env: { ...process.env, NODE_ENV: 'production' }, stdout: 'pipe', stderr: 'pipe' });
    expect(run.exitCode).toBe(0);
    const actual = JSON.parse(new TextDecoder().decode(run.stdout));
    // Setting the launch environment alone cannot repair a development build.
    expect(actual.runtime).toBe('production');
    expect(actual.compiled).toBe('production');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

test('manual executable build scripts compile in production mode too', () => {
  const gateway = JSON.parse(readFileSync(join(root, 'apps/gateway/package.json'), 'utf8')) as { scripts: Record<string, string> };
  for (const name of ['build:exe', 'build:exe:linux', 'build:exe:macos']) {
    expect(gateway.scripts[name].startsWith('NODE_ENV=production bun build --compile ')).toBe(true);
  }
});

test('Docker binary compilation establishes production mode before Bun build', () => {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const binaryStage = dockerfile.split('FROM builder AS binary-builder')[1].split('FROM oven/bun:')[0];
  const declaration = binaryStage.indexOf('ENV NODE_ENV=production');
  const compilation = binaryStage.indexOf('bun build --compile');
  expect(declaration).toBeGreaterThanOrEqual(0);
  expect(declaration).toBeLessThan(compilation);
});
