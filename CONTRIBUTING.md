# Contributing

## Setup

```sh
npm ci
npm test && npm run typecheck && npm run lint
npm run build && npm run gallery    # re-render docs/gallery/*.svg
npm run web:dev                     # gallery + live editor at http://localhost:5173
```

## Visual changes

The tests catch broken geometry (NaN, overlapping cards, missing gradients) but not ugliness. For any change to
`src/render.ts` or `src/layout.ts`, run `npm run build && npm run gallery`, open every SVG in `docs/gallery/`, and
attach before/after screenshots to the PR.

## Adding a gallery scene

Map a well-known project **from its own docs or config only** (README, architecture docs, compose files). Put the
files you used in the `source` field. If a component isn't documented, leave it out. Name the file
`owner__repo.json`.

## Adding a building kind

Add it to `KINDS` in `src/scene.ts`, give it a colour in `PALETTE` and a case in `building()` in `src/render.ts`,
describe when to use it in `skills/repoland/SKILL.md`, and make sure the fuzz test still passes.
