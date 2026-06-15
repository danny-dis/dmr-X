import * as React from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Lightweight markdown renderer                                              */
/* -------------------------------------------------------------------------- */
/*                                                                             */
/*  We deliberately avoid pulling in `react-markdown` / `marked` to keep the   */
/*  bundle small. The renderer below supports the subset of GFM that LLM      */
/*  responses actually emit:                                                   */
/*                                                                             */
/*    - Fenced code blocks (```lang ... ```) with a "copy" button             */
/*    - Inline code (`...`)                                                    */
/*    - Bold (**...** / __...__)                                               */
/*    - Italic (*...* / _..._)                                                 */
/*    - Strikethrough (~~...~~)                                                */
/*    - Inline links ([text](url))                                             */
/*    - ATX headings (# ... ######)                                            */
/*    - Unordered (- / * / +) and ordered (1. 2. 3.) lists                     */
/*    - Block quotes (> ...)                                                   */
/*    - Horizontal rules (--- / *** / ___)                                     */
/*    - Paragraphs separated by blank lines                                    */
/*                                                                             */
/*  Streaming-friendly: it parses on every render, but the parser is O(n)      */
/*  over the markdown string and React's reconciler only updates the tail.     */
/* -------------------------------------------------------------------------- */

type Inline =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'em'; value: string }
  | { kind: 'del'; value: string }
  | { kind: 'link'; value: string; href: string };

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: string }
  | { kind: 'paragraph'; content: string }
  | { kind: 'code'; lang: string; content: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; content: string }
  | { kind: 'hr' };

// Combined inline regex. Order matters — bold (with two markers) must be tried
// before italic (single marker) so `**a**` doesn't get tokenized as `*` `*a*` `*`.
const INLINE_RE =
  /(\*\*([^*]+)\*\*|__([^_]+)__)|(\*([^*]+)\*|_([^_]+)_)|(~~([^~]+)~~)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;

function tokenizeInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: 'text', value: text.slice(last, m.index) });
    }
    if (m[2] !== undefined) out.push({ kind: 'strong', value: m[2] });
    else if (m[3] !== undefined) out.push({ kind: 'strong', value: m[3] });
    else if (m[5] !== undefined) out.push({ kind: 'em', value: m[5] });
    else if (m[6] !== undefined) out.push({ kind: 'em', value: m[6] });
    else if (m[8] !== undefined) out.push({ kind: 'del', value: m[8] });
    else if (m[10] !== undefined) out.push({ kind: 'code', value: m[10] });
    else if (m[12] !== undefined) out.push({ kind: 'link', value: m[12], href: m[13] });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push({ kind: 'text', value: text.slice(last) });
  }
  return out;
}

function parseBlocks(src: string): Block[] {
  // Normalize line endings and split.
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Skip blank lines between blocks.
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block — ```lang ... ```
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        buf.push(lines[i] ?? '');
        i++;
      }
      // Skip the closing fence if present.
      if (i < lines.length) i++;
      blocks.push({ kind: 'code', lang, content: buf.join('\n') });
      continue;
    }

    // ATX heading.
    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: 'heading', level, content: headingMatch[2]! });
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    // Block quote — collect contiguous `> ` lines.
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        buf.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ kind: 'quote', content: buf.join('\n') });
      continue;
    }

    // List — collect contiguous `- ` / `* ` / `+ ` / `1. ` lines.
    const listMatch = /^(\s*)([-*+]|\d+\.)\s+/.exec(line);
    if (listMatch && (listMatch[2] === '-' || listMatch[2] === '*' || listMatch[2] === '+' || /^\d+\.$/.test(listMatch[2]))) {
      const ordered = /^\d+\.$/.test(listMatch[2]!);
      const items: string[] = [];
      const re = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        const m = re.exec(cur);
        if (!m) break;
        items.push(m[1] ?? '');
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // Paragraph — collect contiguous non-blank lines that don't start a new
    // block syntax.
    const buf: string[] = [line];
    i++;
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (cur.trim() === '') break;
      if (/^(#{1,6}\s|```|>|[-*+]\s|\d+\.\s)/.test(cur)) break;
      if (/^([-*_])\1{2,}\s*$/.test(cur)) break;
      buf.push(cur);
      i++;
    }
    blocks.push({ kind: 'paragraph', content: buf.join('\n') });
  }

  return blocks;
}

function renderInlineTokens(tokens: Inline[], keyPrefix: string): React.ReactNode[] {
  return tokens.map((tok, idx) => {
    const k = `${keyPrefix}-${idx}`;
    switch (tok.kind) {
      case 'text':
        return <React.Fragment key={k}>{tok.value}</React.Fragment>;
      case 'code':
        return (
          <code
            key={k}
            className="px-1.5 py-0.5 rounded bg-surface-3 text-[0.85em] font-mono border border-border/60"
          >
            {tok.value}
          </code>
        );
      case 'strong':
        return <strong key={k} className="font-semibold text-fg">{tok.value}</strong>;
      case 'em':
        return <em key={k} className="italic">{tok.value}</em>;
      case 'del':
        return <del key={k} className="line-through text-fg-muted">{tok.value}</del>;
      case 'link':
        return (
          <a
            key={k}
            href={tok.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
          >
            {tok.value}
          </a>
        );
    }
  });
}

function CodeBlock({ lang, content }: { lang: string; content: string }) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = React.useCallback(() => {
    navigator.clipboard.writeText(content).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // ignore — clipboard can be blocked in non-secure contexts
      },
    );
  }, [content]);

  return (
    <div className="my-3 group/code relative overflow-hidden rounded-lg border border-border bg-surface-3">
      <div className="flex items-center justify-between border-b border-border bg-surface-2/60 px-3 py-1.5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-fg-muted">
          {lang || 'text'}
        </span>
        <button
          onClick={onCopy}
          className="flex items-center gap-1 text-[10px] font-medium text-fg-muted transition-colors hover:text-fg"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className={cn('font-mono text-fg', lang && `language-${lang}`)}>
          {content}
        </code>
      </pre>
    </div>
  );
}

function BlockView({ block, idx }: { block: Block; idx: number }) {
  switch (block.kind) {
    case 'heading': {
      const sizes: Record<number, string> = {
        1: 'text-2xl font-semibold mt-5 mb-2',
        2: 'text-xl font-semibold mt-4 mb-2',
        3: 'text-lg font-semibold mt-3 mb-1.5',
        4: 'text-base font-semibold mt-3 mb-1.5',
        5: 'text-sm font-semibold mt-2 mb-1',
        6: 'text-sm font-medium mt-2 mb-1 text-fg-muted',
      };
      const cls = sizes[block.level] ?? sizes[3]!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Tag = (`h${block.level}`) as any;
      return (
        <Tag key={idx} className={cls}>
          {renderInlineTokens(tokenizeInline(block.content), `h${idx}`)}
        </Tag>
      );
    }
    case 'paragraph': {
      // Preserve the soft line breaks inside a paragraph.
      const lines = block.content.split('\n');
      return (
        <p key={idx} className="text-sm leading-relaxed my-2">
          {lines.map((line, li) => (
            <React.Fragment key={li}>
              {renderInlineTokens(tokenizeInline(line), `p${idx}-${li}`)}
              {li < lines.length - 1 ? <br /> : null}
            </React.Fragment>
          ))}
        </p>
      );
    }
    case 'code':
      return <CodeBlock key={idx} lang={block.lang} content={block.content} />;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={idx}
          className={cn(
            'my-2 pl-6 text-sm leading-relaxed',
            block.ordered ? 'list-decimal' : 'list-disc',
            '[&>li]:my-0.5 marker:text-fg-muted',
          )}
        >
          {block.items.map((item, ii) => (
            <li key={ii}>{renderInlineTokens(tokenizeInline(item), `l${idx}-${ii}`)}</li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote
          key={idx}
          className="my-3 border-l-2 border-primary/40 bg-primary/5 pl-3 py-1 text-sm italic text-fg-muted"
        >
          {renderInlineTokens(tokenizeInline(block.content), `q${idx}`)}
        </blockquote>
      );
    case 'hr':
      return <hr key={idx} className="my-4 border-border" />;
  }
}

export interface MarkdownProps {
  source: string;
  className?: string;
}

export function Markdown({ source, className }: MarkdownProps) {
  const blocks = React.useMemo(() => parseBlocks(source), [source]);
  return (
    <div className={cn('markdown', className)}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} idx={i} />
      ))}
    </div>
  );
}
