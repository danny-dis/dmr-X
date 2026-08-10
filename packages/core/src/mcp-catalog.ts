/**
 * Curated catalog of well-known MCP servers.
 *
 * This ships with DMR-X rather than being fetched from a remote registry, so
 * the "discover servers" surface works offline and in air-gapped installs, and
 * so a network outage can never empty the list.
 *
 * Each entry is a *template*, not a connection: `requiredEnv` describes the
 * credentials an operator must supply, and the UI generates a form from it.
 * Nothing here is connected until the operator installs it and the connection
 * test passes.
 *
 * `args` may contain `{{PLACEHOLDER}}` tokens matching a `requiredEnv.key`.
 * They are substituted at install time — see `renderCatalogArgs`.
 */

export type McpCatalogCategory =
  | 'development'
  | 'data'
  | 'productivity'
  | 'search'
  | 'cloud'
  | 'automation'
  | 'memory';

export interface McpCatalogEnvVar {
  /** Environment variable name, also the `{{token}}` used in `args`. */
  key: string;
  /** Human label for the generated form field. */
  label: string;
  /** Rendered under the field. Say where to obtain the value. */
  help?: string;
  /** Render as a password field and never echo the value back to the client. */
  secret?: boolean;
  /** A field may be optional — the server still starts without it. */
  optional?: boolean;
  /** Prefilled default for non-secret fields. */
  placeholder?: string;
}

export interface McpCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: McpCatalogCategory;
  /** lucide-react icon name, resolved by the UI. */
  icon: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  requiredEnv: McpCatalogEnvVar[];
  docsUrl?: string;
  /** Official reference implementation vs. third-party. Shown as a badge. */
  official?: boolean;
}

export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  // ── Development ─────────────────────────────────────────────────────────
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read, write and search files under a directory you allowlist.',
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
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    official: true,
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Read repository history, diffs and blame for a local checkout.',
    category: 'development',
    icon: 'GitBranch',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git', '{{REPO_PATH}}'],
    requiredEnv: [
      { key: 'REPO_PATH', label: 'Repository path', help: 'Absolute path to a git working tree.' },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    official: true,
  },
  {
    id: 'github',
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
    name: 'Fetch',
    description: 'Retrieve a URL and convert the page to markdown for the model.',
    category: 'search',
    icon: 'Globe',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    requiredEnv: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    official: true,
  },
  {
    id: 'context7',
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
    name: 'Knowledge Graph Memory',
    description: 'Persistent entity/relation memory the model can write to and query.',
    category: 'memory',
    icon: 'Brain',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    requiredEnv: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    official: true,
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Structured step-by-step reasoning scratchpad as a tool.',
    category: 'memory',
    icon: 'Workflow',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    requiredEnv: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    official: true,
  },
  {
    id: 'everything',
    name: 'Everything (reference)',
    description: 'The MCP reference server. Exercises every protocol feature — useful for testing.',
    category: 'development',
    icon: 'TestTube',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    requiredEnv: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everything',
    official: true,
  },
] as const;

export const MCP_CATALOG_CATEGORIES: Record<McpCatalogCategory, string> = {
  development: 'Development',
  data: 'Data',
  productivity: 'Productivity',
  search: 'Search & Web',
  cloud: 'Cloud & Infra',
  automation: 'Automation',
  memory: 'Memory & Reasoning',
};

export function getCatalogEntry(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.id === id);
}

/**
 * Substitute `{{KEY}}` tokens in a catalog entry's args from supplied values.
 *
 * Some servers take a path or connection string as a positional argument
 * rather than an env var (filesystem, postgres, sqlite), so the same value the
 * operator typed has to be able to reach either place. A token with no
 * matching value is left intact so the failure surfaces in the connection test
 * rather than silently becoming the empty string — an empty allowlist path
 * would otherwise read as "current directory".
 */
export function renderCatalogArgs(args: string[] | undefined, values: Record<string, string>): string[] {
  if (!args) return [];
  return args.map((arg) =>
    arg.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
      values[key] !== undefined && values[key] !== '' ? values[key] : whole,
    ),
  );
}
