import { spawn, ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { WorkspaceManager } from './workspace-manager.js';
import { BrowserManager } from './browser-manager.js';
import type { AgentPCConfig, AgentPCState, AgentPCInfo, CreateAgentPCOptions, BrowserHandle } from './types.js';

/**
 * AgentPC — a personal computer for one agent.
 *
 * Each agent gets:
 *   - An isolated workspace directory (its own filesystem)
 *   - An isolated browser profile (its own cookies/sessions)
 *   - A child process to run its code
 *
 * Lightweight: no VMs, no containers, no Docker. Just directories and processes.
 * On Windows this is the only option that works without WSL/Hyper-V.
 */
export class AgentPC {
  private workspaceManager: WorkspaceManager;
  private browserManager: BrowserManager;
  private process: ChildProcess | null = null;
  private browser: BrowserHandle | null = null;
  private _state: AgentPCState = 'stopped';
  private _startedAt: Date | null = null;
  private _error: string | null = null;

  public readonly config: AgentPCConfig;

  constructor(options: CreateAgentPCOptions) {
    this.config = {
      agentId: options.agentId,
      name: options.name ?? options.agentId,
      workspaceRoot: '', // Will be set in init
      browserProfileDir: '', // Will be set in init
      entryPoint: options.entryPoint,
      env: options.env ?? {},
      limits: options.limits ?? {},
      autoClean: options.autoClean ?? false,
    };
    this.workspaceManager = new WorkspaceManager(options.baseWorkspaceDir);
    this.browserManager = new BrowserManager(options.baseBrowserProfileDir);
  }

  /**
   * Initialize the agent's workspace and browser profile.
   */
  async init(): Promise<void> {
    const workspaceRoot = await this.workspaceManager.createWorkspace(this.config.agentId);
    const browserProfileDir = this.browserManager.getProfileDir(this.config.agentId);
    this.config.workspaceRoot = workspaceRoot;
    this.config.browserProfileDir = browserProfileDir;
  }

  /**
   * Start the agent process and browser.
   */
  async start(): Promise<void> {
    if (this._state === 'running') {
      throw new Error(`Agent ${this.config.agentId} is already running`);
    }

    await this.init();

    this._state = 'starting';

    // Start browser
    try {
      this.browser = await this.browserManager.createBrowser(this.config.agentId);
    } catch (err) {
      this._state = 'error';
      this._error = err instanceof Error ? err.message : String(err);
      throw err;
    }

    // Start agent process
    try {
      const env = {
        ...process.env,
        ...this.config.env,
        AGENT_PC_WORKSPACE: this.config.workspaceRoot,
        AGENT_PC_BROWSER_PROFILE: this.config.browserProfileDir,
        AGENT_PC_ID: this.config.agentId,
      };

      this.process = spawn(process.execPath, [resolve(this.config.entryPoint)], {
        cwd: this.config.workspaceRoot,
        env,
        // ponytail: detached but NOT ignored — we want to track the process,
        // but we don't want our parent to block on it.
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.on('exit', (code, signal) => {
        this._state = 'stopped';
        this._error = code !== 0 ? `Process exited with code ${code}` : null;
      });

      this.process.on('error', (err) => {
        this._state = 'error';
        this._error = err.message;
      });

      this._startedAt = new Date();
      this._state = 'running';
    } catch (err) {
      this._state = 'error';
      this._error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Stop the agent process and browser.
   */
  async stop(): Promise<void> {
    this._state = 'stopping';

    // Kill the process
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      // ponytail: give it 5 seconds to exit gracefully, then force kill.
      // No fancy process group management — just a simple timeout.
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }

    // Close the browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this._state = 'stopped';
  }

  /**
   * Get current state.
   */
  get state(): AgentPCState {
    return this._state;
  }

  /**
   * Get process ID.
   */
  get pid(): number | null {
    return this.process?.pid ?? null;
  }

  /**
   * Get info snapshot.
   */
  getInfo(): AgentPCInfo {
    return {
      agentId: this.config.agentId,
      name: this.config.name ?? this.config.agentId,
      state: this._state,
      workspaceRoot: this.config.workspaceRoot,
      browserProfileDir: this.config.browserProfileDir,
      pid: this.pid,
      startedAt: this._startedAt,
      uptimeMs: this._startedAt ? Date.now() - this._startedAt.getTime() : null,
      error: this._error ?? undefined,
    };
  }
}
