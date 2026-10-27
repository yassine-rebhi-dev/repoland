# Launch plan

Organic and manual only: no bought stars, star-swaps, automated posting or sock puppets.

## Why this product (evidence from the trending study, `../reports/`)
- Biggest cold-start spikes in the 2026-07..10 window included agent skills that **produce a striking visual**
  (`wheresryan22/anatomy`, isometric illustrations: best day 3,620 stars; brag 1,761; mono-color 1,287; ip-as-logo 1,256)
  and **"visualize my codebase"** tools (`Graphify-Labs/graphify`, best day 5,578, 135k stars total).
- The output is the advertisement: every README that embeds a `repoland.svg` shows "made with repoland".
- Caveat: across all repos, "produces a visual artifact" was positive but not significant (+9.9 pts in the agent
  wave, CI [-0.6, +21.4]). It describes the tail of winners; it is not a guarantee.

## Target
- Launch day: **400+ stars** (TypeScript daily page). P(seen on Trending) was ~14% at 400-799/day and ~53% at 800+.
- 72 h: ~1,000.

## Before launch
- [ ] Push to `github.com/yassine-rebhi-dev/repoland`, enable Pages (Settings → Pages → GitHub Actions), `npm publish`.
- [ ] Map 10 more well-known repos from their docs (aim for variety: a Rust CLI, a Django app, a Go service, a
      monorepo). Each new map is a social post.
- [ ] **Ask 5-10 maintainers whose project is in the gallery** whether the map is right, and offer them the SVG for
      their README. One maintainer adopting it is the strongest launch signal.
- [ ] Record two 20-second captures: (a) the 3D explorer on immich (orbit, click immich-server, follow a link);
      (b) a PR in a demo repo where the repoland bot comments "Changed: API · Affected: Web, Mobile".
- [ ] Add `examples/repoland-ci.yml` to repoland's own repo so its PRs show the comment (dogfood, and a live demo).

## Launch day (Tue/Wed, ~14:00 UTC; no measured day effect, pick when you can reply for 6-8 h)
1. **Show HN:** "Show HN: Repoland – architecture diagrams that fail CI when they go stale (and render in 3D)".
   Lead with the problem every team has (diagrams rot), then the 3D explorer link, then `scan` (no AI needed).
2. **X / Bluesky:** a 20-second screen capture of the 3D explorer (orbit, click a building, panel opens), then
   the PR-impact image (red/amber rings), then `npx repoland scan` on a famous repo. Video first: it's the wow.
3. **Reddit:** r/ClaudeAI ("I made a skill that draws your repo as an isometric town"), r/selfhosted with the
   immich and plausible maps (check each sub's self-promotion rules first).
4. Reply to every "do mine" with a map. That's the content loop for the whole day.

## Week one
| Day | Do |
|---|---|
| 1 | Launch; draw maps people ask for and reply with them |
| 2 | Ship fixes from day 1 (layout bugs on real repos become regression tests) |
| 3 | Add the most-requested building kind or a dark theme |
| 4-5 | Post 2-3 new maps of trending repos (credit the projects, link their repos) |
| 6-7 | Record what worked (GitHub Insights → Traffic referrers) for launch #2 |
