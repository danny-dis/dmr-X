-- 079_seed_web_research_skills.sql
--
-- Make the web-research workflow skills PERMANENT.
--
-- Why this is a migration and not an API call:
--   Skills live in the `skills` table (migration 045). Creating one via
--   POST /v1/skills writes a single DB row, so it is lost the moment the
--   database is reset, recreated on a fresh clone, or moved to another machine.
--   Agents would silently go back to having no research methodology — the exact
--   class of invisible failure this content exists to prevent.
--
-- Why the seed targets tenants BY NAME, not by id:
--   The default tenant id is generated with crypto.randomUUID() on first boot
--   (apps/gateway/src/server.ts), and is therefore different on every install.
--   Nothing can hardcode it. We seed EVERY existing tenant instead, which is
--   also what makes this correct for multi-tenant deployments.
--
-- Idempotency:
--   `skills` has UNIQUE(tenant_id, name) (migration 045), and every INSERT below
--   is guarded by NOT EXISTS, so re-running is a no-op and hand-edited copies of
--   these skills are never overwritten.
--
-- Deliberately NOT using `source = 'builtin'`:
--   'builtin' is the column default and is already used by user-imported rows on
--   this install. These use source = 'seed' so an operator can tell
--   platform-shipped methodology from imported/authored skills, and so a future
--   migration can safely UPDATE its own rows without touching user content.

-- ---------------------------------------------------------------------------
-- url-hunting-recovery
-- ---------------------------------------------------------------------------
-- Teaches an agent to find and VERIFY a page when it has no search engine.
-- The critical lesson is that HTTP 200 does not mean the page exists: dead doc
-- URLs answer with a cross-host redirect to an error shell carrying a plausible
-- <title> and hundreds of KB of chrome. Verified live against
-- docs.anthropic.com -> platform.claude.com (404, 675 KB, title
-- "Documentation | Claude Platform", marker __next_error__).

INSERT INTO skills (id, tenant_id, name, description, content, tags, source)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-a' ||
  substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  t.id,
  'url-hunting-recovery',
  'Find and verify web pages without a search engine: guess canonical URLs, detect 200-but-dead error shells via finalUrl/suspectedErrorShell, recover from 404s, and never fabricate a source.',
  '# URL Hunting & Recovery — finding a page when you don''t know its address

You have `web_fetch` (read a URL you name) and `web_search` (only if the operator
configured `DMRX_SEARCH_API_KEY`). If `web_search` returns
`web_search unavailable: DMRX_SEARCH_API_KEY not configured`, you have **no
search engine** — and this file is how you work anyway.

**Never fabricate a source.** Reporting "I could not reach it" is always better
than inventing a page, a quote, or a statistic. A confident wrong answer is worse
than an honest gap.

## Rule 1 — never fetch a search engine''s results page

Do **not** call `web_fetch` on `duckduckgo.com/html/?q=...`,
`bing.com/search?q=...`, or `google.com/search?q=...`.

Those pages build their results with JavaScript. `web_fetch` returns the raw
markup, so you get a 12–120 KB page containing **zero result links** — often an
HTTP `202` challenge page. Measured directly:

```
https://html.duckduckgo.com/html/?q=...   -> 202, 14200 bytes, 0 result links
https://lite.duckduckgo.com/lite/?q=...   -> 202, 14232 bytes, 0 result links
```

There is nothing in it to follow. Skip straight to Rule 2.

## Rule 2 — guess the canonical URL and fetch it directly

You usually know more than you think. Documentation lives at predictable
addresses.

| You want | Try |
|---|---|
| A library''s docs | `https://docs.<project>.com/`, `https://<project>.dev/docs` |
| A GitHub project | `https://github.com/<org>/<repo>`, `.../blob/main/README.md` |
| A Python package | `https://pypi.org/project/<name>/` |
| An npm package | `https://www.npmjs.com/package/<name>` |
| A paper | `https://arxiv.org/abs/<id>` (the `/abs/` form is citation-ready) |
| A blog post | fetch the blog **index** first, then read its links |

Fetch 2–4 candidates, then judge them by `status` and `bytes`.

## Rule 3 — a 200 does NOT mean the page exists

This is the trap that produces fake citations.

Dead documentation URLs frequently redirect to a **different host** that serves
an error shell — with a plausible `<title>` and hundreds of KB of page chrome.
A real measured example:

```
requested : https://docs.anthropic.com/en/docs/build-with-claude/agentic-design-patterns
finalUrl  : https://platform.claude.com/docs/en/build-with-claude/agentic-design-patterns
status    : 404
bytes     : 675781          <- large! looks like real content
title     : "Documentation | Claude Platform"   <- looks legitimate!
marker    : __next_error__   <- the giveaway
```

675 KB and a sensible title, but the page does not exist. **Always check these
fields before you trust or cite anything:**

- `status` — 404/403/5xx means stop.
- `finalUrl` and `crossHostRedirect` — if you were redirected to another host, be
  suspicious. You asked for A and got B.
- `suspectedErrorShell` — present ONLY when the tool spotted a problem despite
  the HTTP status (an `__next_error__` marker, a "Not Found" title, or almost no
  text). **When this field is present, do not cite the content.** Treat the URL
  as dead and try a variant.
- `bytes` vs text length — a big body that strips to very little text is
  navigation chrome, not an article.

## Rule 4 — when a URL fails, hunt the right slug

Do not retry the identical URL; it will fail identically. Change something:

1. **Fetch the index and read its links.** If `site.com/2025/07/02/thing.html`
   404s, fetch `site.com/blog/` and look for the real post URL in the text.
2. **Try path variants:** `-` <-> `_`, singular <-> plural, with/without trailing
   slash, `/docs/x` <-> `/x/docs`, `docs.` subdomain <-> root domain.
3. **Drop to a parent path.** If `/docs/a/b/c` fails, try `/docs/a/b`, then
   `/docs/a`. A section index will usually name the page you want.
4. **Use `sitemap.xml`** — many sites serve a plain-text list of every URL.

Cap the hunt at roughly 4–5 fetches. Then report honestly what you tried.

## Rule 5 — report what actually happened

End research with a sources list carrying the **real** outcome of each fetch:

```
[OK]   https://arxiv.org/abs/2407.16833          200, 48k, read
[DEAD] https://docs.anthropic.com/en/docs/...    404 via cross-host redirect (error shell)
[WARN] https://example.com/guide                 200 but suspectedErrorShell — not cited
```

Separate what you **read** from what you **infer**. If a claim rests on your own
prior knowledge rather than a page you actually fetched, label it clearly as
unverified. That distinction is the whole value of doing the research.

## Quick checklist

1. Need a specific page? -> `web_fetch` it.
2. Don''t know the URL? -> guess canonical candidates (Rule 2), never a search page.
3. Got a response? -> check `status`, `finalUrl`, `suspectedErrorShell` **before**
   reading the text.
4. Failed? -> change the URL (Rule 4), max ~5 tries.
5. Report real statuses; never invent a source.
',
  '["research","web","fetch","citations","verification"]',
  'seed'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM skills s WHERE s.tenant_id = t.id AND s.name = 'url-hunting-recovery'
);

-- ---------------------------------------------------------------------------
-- grounded-research-brief
-- ---------------------------------------------------------------------------
-- The companion discipline: having fetched real pages, produce an answer whose
-- claims are traceable, and mark the gaps instead of smoothing over them.

INSERT INTO skills (id, tenant_id, name, description, content, tags, source)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-a' ||
  substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  t.id,
  'grounded-research-brief',
  'Turn fetched pages into a cited brief: separate read-from-source facts from inference, record each URL''s real HTTP outcome, and label unverified claims instead of hiding them.',
  '# Grounded Research Brief — answering from sources, not from memory

Use with `url-hunting-recovery`. That skill gets you real pages; this one turns
them into an answer a reviewer can trust.

## The rule that matters

**Every factual claim is either (a) supported by a page you actually fetched in
this run, or (b) explicitly labelled as unverified.** There is no third category.
Fluent prose that blends the two is the single most damaging thing you can
produce, because the reader cannot tell which parts to check.

## Workflow

1. **Fetch first, write second.** Never draft from memory and then look for links
   to justify it. That is backwards and it produces citations that do not say
   what you claim.
2. **Quote or paraphrase only what is in the fetched text.** If you cannot point
   at the sentence, you do not have the fact.
3. **Note the fetch outcome as you go**: URL, status, and whether
   `suspectedErrorShell` was set. A page you could not read is evidence about the
   gap, not something to quietly drop.
4. **Write the brief**, leading with a definition or taxonomy — tables beat prose
   for options and failure modes.
5. **Close with a sources list** giving each URL''s real result.

## Structure

```
## Answer
<lead with the direct answer, 2-3 sentences>

## Detail
<one section per sub-question actually asked>

## Unverified
<claims from prior knowledge, NOT from a fetched page — say so plainly>

## Sources
[OK]   <url>  200, <bytes>, read
[DEAD] <url>  404 (or cross-host redirect to an error shell)
[WARN] <url>  200 but suspectedErrorShell — not cited
```

## Honesty requirements

- **Never invent a URL, title, author, date, or statistic.** If you did not fetch
  it, you do not have it.
- **Do not claim breadth you do not have.** Three fetched pages is "based on
  three sources", not "the current consensus".
- **If everything failed, say so.** "I could not reach any source for this; here
  is what I tried and what I believe from prior knowledge, unverified" is a
  legitimate and useful answer. A confident fabricated brief is not.
- **Recency:** you cannot know today''s events from training data. Anything
  time-sensitive must come from a fetched page or be marked unverified.
- **Contradictions are findings.** If two sources disagree, report the
  disagreement rather than silently picking one.

## Anti-patterns

| Looks like | Actually is |
|---|---|
| Citing a URL you did not fetch | fabrication |
| "Studies show..." with no source | unverified claim dressed as fact |
| Dropping a 404 from the sources list | hiding a gap |
| Citing a page whose `suspectedErrorShell` was set | citing an error page |
| Fetching a search results page and reporting nothing found | wrong method (see Rule 1 of url-hunting-recovery) |
',
  '["research","citations","honesty","verification","writing"]',
  'seed'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM skills s WHERE s.tenant_id = t.id AND s.name = 'grounded-research-brief'
);
