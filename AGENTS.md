# AGENTS.md

repoland maps a codebase as an isometric town: a scene (JSON: parts + flows + owned code paths) rendered as an SVG
or an interactive three.js page, and checked against the repo (drift) and against diffs (PR impact).
TypeScript, Node >= 20. The CLI has zero runtime dependencies; three.js is bundled into the viewer at build time.

## Commands

```sh
npm ci                  # install (lockfile is committed)
npm test                # vitest: unit tests, 200-scene render fuzz, real-repo regressions, CLI on temp git repos
npm run typecheck       # strict tsc for the CLI/library and for the browser code (viewer/, web/)
npm run lint            # biome
npm run build           # dist/src (CLI + library) and dist/viewer/repoland-viewer.js (3D bundle)
npm run gallery         # re-render docs/gallery/*.svg from gallery/*.json (after build)
npm run web:dev         # site: 3D hero, gallery, live 2D/3D editor
```

## Layout

- `src/scene.ts`: scene format + validation. Every error carries a JSON path; agents read these.
- `src/layout.ts`: layering by data flow, crossing reduction, orthogonal pipe routing. Pure, deterministic.
- `src/render.ts`: SVG: one building per kind, pipes, districts, impact highlight, label placement.
- `src/scan.ts`: no-LLM draft from compose files, workspaces, Cargo/Go modules, dependency-implied infrastructure.
- `src/drift.ts` / `src/impact.ts`: map vs code, and changed files -> parts -> dependents.
- `src/repo.ts`: file access (`git ls-files` minus deleted files; in-memory repo for tests). `src/glob.ts`: globs.
- `src/insights.ts`: git activity and CODEOWNERS ownership per part, and the overlays that colour by them.
- `src/mermaid.ts`: Mermaid export. `src/mcp.ts`: MCP server (stdio JSON-RPC), tools for agents.
- `src/html.ts`: self-contained 3D page. `src/cli.ts`: all commands.
- `viewer/`: three.js explorer (`mount(el, scene, opts)`), built to `dist/viewer/`.
- `skills/repoland/SKILL.md`: the agent instructions shipped in the npm package.
- `gallery/*.json`: real projects; `source` names the docs used.

## Rules

- No runtime dependencies in `src/`.
- Same input, same output: no randomness or clocks in layout/render.
- Visual changes: `npm run build && npm run gallery`, open the SVGs and an `--html` page, attach screenshots to the PR.
- Scanner changes: add the real repo case to `test/scan.test.ts` ("real-world regressions").
- Gallery scenes may only contain components the project's own docs, config or tree show.
