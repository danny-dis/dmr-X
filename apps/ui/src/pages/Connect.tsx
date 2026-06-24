import { Plug, Play, Code, Server, Webhook, KeyRound } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Code as CodeBlock } from '@/components/primitives/Code';
import { CopyButton } from '@/components/primitives/CopyButton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { maskKey } from '@/lib/formatters';

const EXAMPLES = {
  openai: {
    title: 'OpenAI compatible',
    subtitle: '/v1/chat/completions',
    code: `curl http://localhost:3000/v1/chat/completions \\
  -H "Authorization: Bearer $DMRX_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "Hello, world!"}
    ]
  }'`,
  },
  anthropic: {
    title: 'Anthropic compatible',
    subtitle: '/v1/messages',
    code: `curl http://localhost:3000/v1/messages \\
  -H "x-api-key: $DMRX_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello, world!"}
    ]
  }'`,
  },
  gemini: {
    title: 'Gemini compatible',
    subtitle: '/v1/gemini/generateContent',
    code: `curl "http://localhost:3000/v1/gemini/generateContent?key=$DMRX_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [{
      "parts": [{"text": "Hello, world!"}]
    }]
  }'`,
  },
  image: {
    title: 'Image generation',
    subtitle: '/v1/images/generations',
    code: `curl http://localhost:3000/v1/images/generations \\
  -H "Authorization: Bearer $DMRX_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "dall-e-3",
    "prompt": "A serene mountain landscape"
  }'`,
  },
  embed: {
    title: 'Embeddings',
    subtitle: '/v1/embeddings',
    code: `curl http://localhost:3000/v1/embeddings \\
  -H "Authorization: Bearer $DMRX_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "text-embedding-3-small",
    "input": "Your text here"
  }'`,
  },
  tool: {
    title: 'Tool execution',
    subtitle: '/v1/tools/execute',
    code: `curl http://localhost:3000/v1/tools/execute \\
  -H "Authorization: Bearer $DMRX_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "Search for DMR-X"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "web_search",
          "description": "Search the web",
          "parameters": {
            "type": "object",
            "properties": {
              "query": {"type": "string"}
            },
            "required": ["query"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'`,
  },
};

export function ConnectPage() {
  const navigate = useNavigate();

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Connect"
        description="API reference, authentication, and integration examples"
        icon={<Plug className="size-5" />}
      />

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="md">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Server className="size-5" />
            </div>
            <div>
              <p className="text-[10px] text-fg-muted uppercase tracking-wider">Endpoint</p>
              <p className="text-sm font-mono text-fg">http://localhost:3000</p>
            </div>
          </div>
        </Card>
        <Card padding="md">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <KeyRound className="size-5" />
            </div>
            <div>
              <p className="text-[10px] text-fg-muted uppercase tracking-wider">Auth</p>
              <p className="text-sm font-mono text-fg">Bearer {maskKey('sk-dmrx-…', 4)}</p>
            </div>
          </div>
        </Card>
        <Card padding="md">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-success/10 text-success">
              <Webhook className="size-5" />
            </div>
            <div>
              <p className="text-[10px] text-fg-muted uppercase tracking-wider">Webhooks</p>
              <p className="text-sm text-fg">SSE · WebSocket · HTTP</p>
            </div>
          </div>
        </Card>
      </div>

      <Card padding="none" className="mt-3">
        <Tabs defaultValue="openai">
          <div className="px-4 pt-4">
            <TabsList>
              {Object.entries(EXAMPLES).map(([k, v]) => (
                <TabsTrigger key={k} value={k}>{v.title}</TabsTrigger>
              ))}
            </TabsList>
          </div>
          {Object.entries(EXAMPLES).map(([k, v]) => (
            <TabsContent key={k} value={k} className="px-4 pb-4 mt-2">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-sm font-semibold text-fg">{v.title}</h3>
                  <p className="text-[10px] text-fg-muted font-mono">{v.subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate('/playground')}
                  >
                    <Play className="size-3" /> Try in Playground
                  </Button>
                  <CopyButton value={v.code} />
                </div>
              </div>
              <CodeBlock inline={false} copyable>
                {v.code}
              </CodeBlock>
            </TabsContent>
          ))}
        </Tabs>
      </Card>

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>SDKs</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Drop-in replacements for existing libraries</p>
          </CardHeader>
          <CardContent className="px-0 flex flex-col gap-2">
            {[
              { name: 'openai', desc: 'OpenAI Python/Node SDKs', lang: 'python' },
              { name: '@anthropic-ai/sdk', desc: 'Anthropic SDKs', lang: 'typescript' },
              { name: '@google/generative-ai', desc: 'Google Generative AI SDKs', lang: 'typescript' },
              { name: 'langchain', desc: 'LangChain integration', lang: 'python' },
            ].map((s) => (
              <div
                key={s.name}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-2.5"
              >
                <Code className="size-3.5 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-mono text-fg">{s.name}</p>
                  <p className="text-[10px] text-fg-muted">{s.desc}</p>
                </div>
                <Badge tone="muted" size="sm">{s.lang}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Meta-model aliases</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">Pre-configured routing strategies</p>
          </CardHeader>
          <CardContent className="px-0 flex flex-col gap-1.5">
            {[
              { name: 'auto', desc: 'Auto-pick best model (paid + free)' },
              { name: 'auto-fast', desc: 'Fastest model' },
              { name: 'auto-smart', desc: 'Smartest model' },
              { name: 'auto-agentic', desc: 'Best for agentic/tool use' },
              { name: 'auto-coding', desc: 'Best for code generation' },
            ].map((a) => (
              <div
                key={a.name}
                className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5"
              >
                <Badge tone="primary" size="sm" className="font-mono">{a.name}</Badge>
                <span className="text-[11px] text-fg-muted">{a.desc}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
