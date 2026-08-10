/**
 * Hand-maintained manifest for the MCP catalog.
 *
 * This is the file humans edit. `scripts/generate-mcp-catalog.ts` merges it
 * with the vendored fork of modelcontextprotocol/servers
 * (`vendored/servers`) and emits `./mcp-catalog.ts` — never edit that file
 * directly.
 *
 * Entry model:
 *
 * - `source: 'fork'`   — the server ships in the active `src/` of the
 *   modelcontextprotocol/servers repo. The generator enriches it with the
 *   package name / description / docs URL read from the fork, so you only
 *   provide `id`, `category`, `icon`, `transport`, `command`+`args` (or
 *   `url`), and `requiredEnv`.
 * - `source: 'curated'` — a server the upstream repo no longer carries (most
 *   reference servers were archived) but that is still useful, pointed at its
 *   current community-maintained package. These are fully hand-written.
 *
 * `command`/`args` may contain `{{KEY}}` tokens matching a `requiredEnv.key`;
 * the generator validates that every token is declared and fails the build
 * otherwise.
 */

import type { McpCatalogCategory } from './mcp-catalog.js';

export type McpCatalogSource = 'fork' | 'curated';

export interface McpCatalogManifestEntry {
  id: string;
  source: McpCatalogSource;
  /**
   * Fork directory name when it differs from `id` (e.g. the fork spells
   * "sequentialthinking" but the catalog id is "sequential-thinking").
   * Only meaningful for `source: 'fork'`.
   */
  forkDir?: string;
  /** Kept in sync with the fork's directory name for `source: 'fork'`. */
  name: string;
  /**
   * Required for `source: 'curated'` (no fork to read it from).
   * Ignored for `source: 'fork'` — the generator takes the description from
   * the fork's package.json / pyproject.toml.
   */
  description?: string;
  category: McpCatalogCategory;
  icon: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  requiredEnv: Array<{
    key: string;
    label: string;
    help?: string;
    secret?: boolean;
    optional?: boolean;
    placeholder?: string;
  }>;
  docsUrl?: string;
  official?: boolean;
}

export const MCP_CATALOG_MANIFEST: readonly McpCatalogManifestEntry[] = [
  // ── Development ─────────────────────────────────────────────────────────
  {
    id: 'filesystem',
    source: 'fork',
    name: 'Filesystem',
    category: 'development',
    icon: 'FolderOpen',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '{{ALLOWED_DIR}}'],
    requiredEnv: [
      {
        key: 'ALLOWED_DIR',
        label: 'Allowed directory',
        help: 'Absolute path. The server can only reach files beneath it.',
        placeholder: '/Users/me/projects',
      },
    ],
    official: true,
  },
  {
    id: 'git',
    source: 'fork',
    name: 'Git',
    category: 'development',
    icon: 'GitBranch',
    transport: 'stdio',
    // Python reference implementation — consumed via uvx, not npx.
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '{{REPO_PATH}}'],
    requiredEnv: [
      { key: 'REPO_PATH', label: 'Repository path', help: 'Absolute path to a git working tree.' },
    ],
    official: true,
  },
  {
    id: 'github',
    source: 'curated',
    name: 'GitHub',
    description: 'Issues, pull requests, code search and file contents across your repos.',
    category: 'development',
    icon: 'Github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@github/mcp-server'],
    requiredEnv: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'Personal access token',
        help: 'github.com → Settings → Developer settings → Personal access tokens.',
        secret: true,
      },
    ],
    docsUrl: 'https://github.com/github/github-mcp-server',
    official: true,
  },
  {
    id: 'gitlab',
    source: 'curated',
    name: 'GitLab',
    description: 'Projects, issues and merge requests on gitlab.com or self-hosted.',
    category: 'development',
    icon: 'Gitlab',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@gitlab/mcp-server'],
    requiredEnv: [
      { key: 'GITLAB_PERSONAL_ACCESS_TOKEN', label: 'Personal access token', secret: true },
      {
        key: 'GITLAB_API_URL',
        label: 'API URL',
        help: 'Leave blank for gitlab.com.',
        optional: true,
        placeholder: 'https://gitlab.com/api/v4',
      },
    ],
    docsUrl: 'https://gitlab.com/gitlab-org/gitlab-mcp-server',
    official: true,
  },
  {
    id: 'sentry',
    source: 'curated',
    name: 'Sentry',
    description: 'Pull issue details and stack traces from a Sentry project.',
    category: 'development',
    icon: 'Bug',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@sentry/mcp-server'],
    requiredEnv: [{ key: 'SENTRY_AUTH_TOKEN', label: 'Auth token', secret: true }],
    docsUrl: 'https://github.com/getsentry/sentry-mcp',
    official: true,
  },

  // ── Data ────────────────────────────────────────────────────────────────
  {
    id: 'postgres',
    source: 'curated',
    name: 'PostgreSQL',
    description: 'Inspect schemas and run read-only queries against a Postgres database.',
    category: 'data',
    icon: 'Database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@henkey/postgres-mcp', '{{DATABASE_URL}}'],
    requiredEnv: [
      {
        key: 'DATABASE_URL',
        label: 'Connection string',
        help: 'Queries are read-only. Prefer a least-privilege role.',
        secret: true,
        placeholder: 'postgresql://user:pass@host:5432/db',
      },
    ],
    docsUrl: 'https://github.com/henkey/postgres-mcp',
    official: false,
  },
  {
    id: 'sqlite',
    source: 'curated',
    name: 'SQLite',
    description: 'Query and describe a local SQLite database file.',
    category: 'data',
    icon: 'Database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', '{{DB_PATH}}'],
    requiredEnv: [{ key: 'DB_PATH', label: 'Database file', placeholder: './data.db' }],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    official: false,
  },
  {
    id: 'redis',
    source: 'curated',
    name: 'Redis',
    description: 'Read and write keys on a Redis instance.',
    category: 'data',
    icon: 'Server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@redis/mcp-redis', '{{REDIS_URL}}'],
    requiredEnv: [
      { key: 'REDIS_URL', label: 'Redis URL', secret: true, placeholder: 'redis://localhost:6379' },
    ],
    docsUrl: 'https://github.com/redis/mcp-redis',
    official: true,
  },
  {
    id: 'pglite',
    source: 'curated',
    name: 'PGlite',
    description: 'Run PostgreSQL in the browser or Node via PGlite, compiled to WASM.',
    category: 'data',
    icon: 'Database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@electric-sql/pglite-mcp'],
    requiredEnv: [],
    docsUrl: 'https://github.com/electric-sql/pglite-mcp',
    official: true,
  },

  // ── Search ──────────────────────────────────────────────────────────────
  {
    id: 'brave-search',
    source: 'curated',
    name: 'Brave Search',
    description: 'Web and local search through the Brave Search API.',
    category: 'search',
    icon: 'Search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@brave/brave-search-mcp-server'],
    requiredEnv: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave API key',
        help: 'Free tier available at brave.com/search/api.',
        secret: true,
      },
    ],
    docsUrl: 'https://github.com/brave/brave-search-mcp-server',
    official: true,
  },
  {
    id: 'fetch',
    source: 'fork',
    name: 'Fetch',
    category: 'search',
    icon: 'Globe',
    transport: 'stdio',
    // Python reference implementation — consumed via uvx, not npx.
    command: 'uvx',
    args: ['mcp-server-fetch'],
    requiredEnv: [],
    official: true,
  },
  {
    id: 'context7',
    source: 'curated',
    name: 'Context7',
    description: 'Inject up-to-date documentation for thousands of libraries into the model context.',
    category: 'search',
    icon: 'BookOpen',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    requiredEnv: [],
    docsUrl: 'https://github.com/upstash/context7',
    official: true,
  },
  {
    id: 'exa',
    source: 'curated',
    name: 'Exa',
    description: 'Semantic and keyword web search over the live web, tuned for AI agents.',
    category: 'search',
    icon: 'Search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'exa-mcp-server'],
    requiredEnv: [{ key: 'EXA_API_KEY', label: 'API key', secret: true }],
    docsUrl: 'https://github.com/exa-labs/exa-mcp-server',
    official: true,
  },
  {
    id: 'tavily',
    source: 'curated',
    name: 'Tavily',
    description: 'Web search built for AI agents: clean, relevant results with context.',
    category: 'search',
    icon: 'Search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'tavily-mcp'],
    requiredEnv: [{ key: 'TAVILY_API_KEY', label: 'API key', secret: true }],
    docsUrl: 'https://github.com/tavily-ai/tavily-mcp',
    official: true,
  },
  {
    id: 'playwright',
    source: 'curated',
    name: 'Playwright',
    description: 'Drive a real browser with Playwright: navigate, click, fill forms and screenshot.',
    category: 'automation',
    icon: 'MousePointerClick',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp'],
    requiredEnv: [],
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
    official: true,
  },
  {
    id: 'chrome-devtools',
    source: 'curated',
    name: 'Chrome DevTools',
    description: 'Drive Chrome via the DevTools Protocol: inspect pages, evaluate JS and capture traces.',
    category: 'automation',
    icon: 'Chrome',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'],
    requiredEnv: [],
    docsUrl: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    official: true,
  },

  // ── Productivity ────────────────────────────────────────────────────────
  {
    id: 'slack',
    source: 'curated',
    name: 'Slack',
    description: 'Read channels, post messages and search history in a workspace.',
    category: 'productivity',
    icon: 'MessageSquare',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@zencoderai/slack-mcp-server'],
    requiredEnv: [
      { key: 'SLACK_BOT_TOKEN', label: 'Bot token', help: 'Starts with xoxb-.', secret: true },
      { key: 'SLACK_TEAM_ID', label: 'Team ID', placeholder: 'T01234567' },
    ],
    docsUrl: 'https://github.com/zencoderai/slack-mcp-server',
    official: false,
  },
  {
    id: 'google-drive',
    source: 'curated',
    name: 'Google Drive',
    description: 'List, search and read documents from Drive.',
    category: 'productivity',
    icon: 'HardDrive',
    transport: 'stdio',
    command: 'uvx',
    args: ['gdrive-mcp-server'],
    requiredEnv: [
      {
        key: 'GDRIVE_CREDENTIALS_PATH',
        label: 'Credentials JSON path',
        help: 'OAuth client credentials file. Requires uv (uvx) to be installed.',
      },
    ],
    docsUrl: 'https://github.com/googleapis/gdrive-mcp-server',
    official: true,
  },
  {
    id: 'notion',
    source: 'curated',
    name: 'Notion',
    description: 'Search, read and update Notion pages and databases.',
    category: 'productivity',
    icon: 'FileText',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    requiredEnv: [
      {
        key: 'NOTION_API_KEY',
        label: 'Integration token',
        help: 'Create an internal integration and share the pages with it.',
        secret: true,
      },
    ],
    docsUrl: 'https://github.com/makenotion/notion-mcp-server',
  },
  {
    id: 'linear',
    source: 'curated',
    name: 'Linear',
    description: 'Query and update Linear issues, projects and cycles.',
    category: 'productivity',
    icon: 'ListTodo',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-linear'],
    requiredEnv: [{ key: 'LINEAR_API_KEY', label: 'API key', secret: true }],
    docsUrl: 'https://linear.app/docs/mcp',
  },
  {
    id: 'todoist',
    source: 'curated',
    name: 'Todoist',
    description: 'Manage Todoist tasks, projects, sections and labels.',
    category: 'productivity',
    icon: 'ListChecks',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@abhiz123/todoist-mcp-server'],
    requiredEnv: [{ key: 'TODOIST_API_TOKEN', label: 'API token', secret: true }],
    docsUrl: 'https://github.com/abhiz123/todoist-mcp-server',
    official: false,
  },
  {
    id: 'figma',
    source: 'curated',
    name: 'Figma',
    description: 'Inspect Figma files, frames, components and styles from a project.',
    category: 'productivity',
    icon: 'Figma',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'figma-developer-mcp', '--figma-api-key={{FIGMA_API_KEY}}'],
    requiredEnv: [
      {
        key: 'FIGMA_API_KEY',
        label: 'Personal access token',
        secret: true,
        help: 'Figma → Settings → Security → Personal access tokens.',
      },
    ],
    docsUrl: 'https://github.com/figma/figma-developer-mcp',
    official: true,
  },

  // ── Cloud ───────────────────────────────────────────────────────────────
  {
    id: 'aws',
    source: 'curated',
    name: 'AWS',
    description: 'Inspect AWS resources and run read-only API calls.',
    category: 'cloud',
    icon: 'Cloud',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-aws-kb-retrieval'],
    requiredEnv: [
      { key: 'AWS_ACCESS_KEY_ID', label: 'Access key ID', secret: true },
      { key: 'AWS_SECRET_ACCESS_KEY', label: 'Secret access key', secret: true },
      { key: 'AWS_REGION', label: 'Region', placeholder: 'us-east-1' },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/aws-kb-retrieval-server',
    official: false,
  },
  {
    id: 'cloudflare',
    source: 'curated',
    name: 'Cloudflare',
    description: 'Manage Workers, KV, R2 and DNS on a Cloudflare account.',
    category: 'cloud',
    icon: 'Cloud',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@cloudflare/mcp-server-cloudflare'],
    requiredEnv: [
      { key: 'CLOUDFLARE_API_TOKEN', label: 'API token', secret: true },
      { key: 'CLOUDFLARE_ACCOUNT_ID', label: 'Account ID' },
    ],
    docsUrl: 'https://github.com/cloudflare/mcp-server-cloudflare',
  },
  {
    id: 'kubernetes',
    source: 'curated',
    name: 'Kubernetes',
    description: 'Inspect cluster resources, pods, logs and events.',
    category: 'cloud',
    icon: 'Boxes',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-server-kubernetes'],
    requiredEnv: [
      {
        key: 'KUBECONFIG',
        label: 'Kubeconfig path',
        help: 'Leave blank to use the default ~/.kube/config.',
        optional: true,
      },
    ],
    docsUrl: 'https://github.com/Flux159/mcp-server-kubernetes',
  },
  {
    id: 'docker',
    source: 'curated',
    name: 'Docker',
    description: 'List containers and images, read logs, inspect the local daemon.',
    category: 'cloud',
    icon: 'Container',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'docker-mcp'],
    requiredEnv: [],
    docsUrl: 'https://github.com/QuantGeekDev/docker-mcp',
  },
  {
    id: 'stripe',
    source: 'curated',
    name: 'Stripe',
    description: 'Query and manage Stripe customers, payments, products and subscriptions.',
    category: 'cloud',
    icon: 'CreditCard',
    transport: 'http',
    url: 'https://mcp.stripe.com',
    requiredEnv: [
      {
        key: 'STRIPE_API_KEY',
        label: 'Restricted API key',
        secret: true,
        help: 'dashboard.stripe.com → API keys → create restricted key. Sent as a Bearer token.',
      },
    ],
    docsUrl: 'https://docs.stripe.com/mcp',
    official: true,
  },
  {
    id: 'supabase',
    source: 'curated',
    name: 'Supabase',
    description: 'Inspect and manage a Supabase project: tables, functions, storage and auth.',
    category: 'cloud',
    icon: 'Server',
    transport: 'http',
    url: 'https://mcp.supabase.com/mcp',
    requiredEnv: [
      {
        key: 'SUPABASE_ACCESS_TOKEN',
        label: 'Access token',
        secret: true,
        help: 'Personal access token starting with sbp_. Sent as a Bearer token.',
      },
    ],
    docsUrl: 'https://supabase.com/docs/guides/mcp',
    official: true,
  },

  // ── Memory ──────────────────────────────────────────────────────────────
  {
    id: 'memory',
    source: 'fork',
    name: 'Knowledge Graph Memory',
    category: 'memory',
    icon: 'Brain',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    requiredEnv: [],
    official: true,
  },
  {
    id: 'sequential-thinking',
    source: 'fork',
    forkDir: 'sequentialthinking',
    name: 'Sequential Thinking',
    category: 'memory',
    icon: 'Workflow',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    requiredEnv: [],
    official: true,
  },
  {
    id: 'everything',
    source: 'fork',
    name: 'Everything (reference)',
    category: 'development',
    icon: 'TestTube',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    requiredEnv: [],
    official: true,
  },

  // ── Time (Python reference implementation, currently absent from the
  //    previous curated list — added from the active fork) ────────────────
  {
    id: 'time',
    source: 'fork',
    name: 'Time',
    category: 'productivity',
    icon: 'Clock',
    transport: 'stdio',
    // Python reference implementation — consumed via uvx, not npx.
    command: 'uvx',
    args: ['mcp-server-time'],
    requiredEnv: [],
    official: true,
  },
] as const;
