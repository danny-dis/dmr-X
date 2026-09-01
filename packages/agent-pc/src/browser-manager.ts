import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BrowserHandle } from './types.js';

// We import playwright lazily so the package loads even if playwright
// isn't installed yet (the CLI will prompt the user to install it).
type PlaywrightChromium = {
  launchPersistentContext: (userDataDir: string, options: {
    headless: boolean;
    args?: string[];
  }) => Promise<{
    close: () => Promise<void>;
    browser: () => { wsEndpoint?: string } | null;
  }>;
};

/**
 * Browser Manager — per-agent isolated browser profile.
 *
 * Each agent gets its own persistentContext (user data dir), so cookies,
 * localStorage, and sessions are isolated between agents. No need for
 * separate browser processes per agent — persistentContext is lightweight.
 */
export class BrowserManager {
  private playwright: { chromium: PlaywrightChromium } | null = null;

  constructor(private baseProfileDir: string) {}

  /**
   * Lazily load playwright.
   */
  private async getPlaywright(): Promise<{ chromium: PlaywrightChromium }> {
    if (!this.playwright) {
      try {
        const mod = await import('playwright');
        const chromium = (mod as any).chromium ?? (mod as any).default?.chromium;
        if (!chromium) {
          throw new Error('playwright.chromium not found');
        }
        this.playwright = { chromium };
      } catch (err) {
        if (err instanceof Error && err.message === 'playwright.chromium not found') {
          throw err;
        }
        throw new Error(
          'playwright is required for browser isolation. Install it: npm install playwright && npx playwright install chromium'
        );
      }
    }
    return this.playwright;
  }

  /**
   * Create an isolated browser context for an agent.
   */
  async createBrowser(agentId: string): Promise<BrowserHandle> {
    const playwright = await this.getPlaywright();
    const profileDir = resolve(this.baseProfileDir, `agent-${agentId}`);
    await mkdir(profileDir, { recursive: true });

    const context = await playwright.chromium.launchPersistentContext(profileDir, {
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });

    return {
      close: async () => {
        await context.close();
      },
      getCdpEndpoint: () => {
        const browser = context.browser();
        return browser?.wsEndpoint ?? null;
      },
    };
  }

  /**
   * Get the profile directory path for an agent.
   */
  getProfileDir(agentId: string): string {
    return resolve(this.baseProfileDir, `agent-${agentId}`);
  }

  /**
   * Get the base profile directory.
   */
  getBaseDir(): string {
    return this.baseProfileDir;
  }
}
