# Changelog

## 0.3.0

- **MCP server** (`repoland mcp`): agents ask which part owns a file, what depends on a part, what changed files
  touch, and whether the map drifted. `claude mcp add repoland -- npx -y repoland mcp`.
- **Activity heatmap** (`--color activity`, `--days N`): commits and people per part from git history, on a
  single-hue ramp ranked across parts.
- **Team ownership** (`--color team`): owners from CODEOWNERS (gitignore-style patterns, last match wins);
  parts with no owner stand out.
- **3D**: switch between kind / activity / team colouring; the panel shows activity and owners.
- **Dark theme** (`--theme dark`, `--theme both` with a ready `<picture>` snippet).
- **Mermaid export** (`export --mermaid`) and **watch mode** (`--watch`).

## 0.2.0

- **3D explorer**: `repoland --html` writes one self-contained page: orbit, search, filter by kind, click a part to
  see its description, owned code paths and connections. Animated queues, workers, models and data flow.
- **`repoland scan`**: drafts a map with no LLM from docker-compose services, npm/pnpm workspaces, Cargo workspaces,
  Go `cmd/` entry points, and infrastructure implied by dependencies (JS, Python, Go).
- **`repoland check`** now detects drift when parts declare `paths`: parts whose code is gone, and code that has no
  part. Exits 1, for CI. `ignore` lists parts left off on purpose.
- **`repoland impact`**: maps changed files (git diff or `--files`) to parts and everything that depends on them;
  SVG/3D highlighting and a Markdown summary for PR comments. Example workflow in `examples/repoland-ci.yml`.
- **Scene format**: optional `paths`, `description`, `group` per part; `groups` (districts) and `ignore` per scene.
  v0.1 scenes are still valid.
- Districts drawn as tinted lots with a legend, in 2D and 3D.

## 0.1.0

- Isometric SVG renderer, agent skill, CLI (`render`, `check`, `skill`, `example`), gallery and web editor.
