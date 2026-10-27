---
name: repoland
description: Map a codebase as an isometric town (SVG + interactive 3D) that stays in sync with the code. Use when the user asks to map, visualize, illustrate or explain the architecture of a repository, to check whether an architecture map is out of date, to see what a change or pull request touches, or says "repoland".
---

# repoland: map this repo, keep the map true

You produce `repoland.json`: the system's moving parts, the code each part owns, and how data flows between them.
The `repoland` CLI turns it into pictures and uses it to check drift and PR impact. You never draw anything; layout
and art are automatic.

## 1. Start from facts: `npx -y repoland scan`

`scan` drafts `repoland.json` from what the repo declares (docker-compose services, workspace packages, Cargo/Go
modules, and the databases, queues and APIs implied by dependencies). It costs nothing and is never invented.
If `repoland.json` already exists, read it instead and update it.

## 2. Refine it by reading the code

Read the README, architecture docs, compose/k8s files and entry points. Then edit the draft:

- **Keep 5-16 parts** a new engineer needs. Merge helpers into the part that owns them; delete tooling the scan kept.
- **Fix kinds and labels** (what people call it), and add a short `note` (technology or job).
- **Add flows the config can't show**: who calls whom, who publishes to which queue, who reads which bucket.
  Label the edges that teach something (`REST`, `gRPC`, `SQL`, `publish`, `webhook`).
- **Every part must correspond to something you saw.** If unsure, leave it out.

| kind | use for |
|---|---|
| `user` | the person or client that starts the flow |
| `frontend` | web/mobile/desktop UI, dashboards |
| `service` | servers, APIs, gateways, long-running processes |
| `worker` | background jobs, cron, consumers, pipelines |
| `database` | SQL/NoSQL stores, vector DBs, search indexes |
| `cache` | Redis/memcached, in-memory or on-disk caches |
| `queue` | message queues, streams, event buses, schedulers |
| `storage` | object/file storage, artifacts, model files |
| `external` | third-party APIs you don't run (Stripe, OpenAI, GitHub…) |
| `cli` | command-line entry points |
| `library` | SDKs, core packages other parts import |
| `model` | ML models, inference engines, embeddings |

## 3. Tie parts to code (this is what keeps the map honest)

For every part that is code in this repo, set `paths` to globs of the files it owns (`"server/src/**"`,
`"apps/web/**"`, `"server/src/services/billing*.ts"`). Add a one or two sentence `description` of its job.
Use `groups` for districts when there are clear areas (clients / backend / data). Put parts you deliberately
leave off the map in `ignore` (labels or globs) so drift checks don't flag them.

```json
{
  "title": "acme-shop",
  "subtitle": "One line: what it does, in plain words",
  "groups": [{ "id": "edge", "label": "Clients" }, { "id": "core", "label": "Backend" }],
  "ignore": ["packages/eslint-config/**"],
  "nodes": [
    { "id": "web", "label": "Storefront", "kind": "frontend", "note": "Next.js", "group": "edge",
      "paths": ["apps/web/**"], "description": "Customer-facing shop; server-renders product pages." },
    { "id": "api", "label": "API", "kind": "service", "note": "Fastify", "group": "core", "paths": ["apps/api/**"] },
    { "id": "db", "label": "Orders DB", "kind": "database", "note": "Postgres", "group": "core" }
  ],
  "edges": [
    { "from": "web", "to": "api", "label": "REST" },
    { "from": "api", "to": "db", "label": "SQL" }
  ]
}
```

Edges point the way requests or data flow: caller -> callee, producer -> queue -> consumer.

## 4. Check, render, report

```sh
npx -y repoland check          # validates; with paths, exits 1 if the map no longer matches the code
npx -y repoland                # repoland.svg (animated, for the README)
npx -y repoland --html         # repoland.html (interactive 3D, single file)
```

Fix exactly what `check` lists and run it again. Then tell the user where the files are and suggest:

```md
![How it works](repoland.svg)
```

## When asked "where is the churn?" or "who owns what?"

```sh
npx -y repoland --color activity       # git commits and people per part (last 90 days; --days N)
npx -y repoland --color team           # owners from CODEOWNERS
```

## When asked "what does this change touch?"

```sh
npx -y repoland impact --md            # against origin/main (or --base <ref>, or --files a,b)
npx -y repoland impact --html          # the same, explorable in 3D
```

## Answering questions about the code

If the repoland MCP server is connected, prefer its tools: `repoland_part_for_file` before editing an unfamiliar
file, `repoland_dependents` before changing a shared part, `repoland_impact` after a change.
