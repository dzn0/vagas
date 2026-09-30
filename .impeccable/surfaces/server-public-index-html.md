---
version: 1
slug: "server-public-index-html"
primary_target: "server/public/index.html"
related_targets: []
---

Scope: results page for /vagas (`server/public/index.html`), served by the local API at http://localhost:3777/. Mode: Operate.

Audience/task: André, after each /vagas run, reviews the AI ranking, reads jobs, and decides: apply, discard (with reason), keep interesting, or follow up. Status/notes writes go to PostgreSQL immediately via PATCH /jobs/:id.

Content: all jobs (deduplicated), default view = AI recommendations (forte/avaliar) not yet acted on; filters for status, verdict, workplace, level, search source; full description with AI summary/highlights/gaps; follow-ups (aplicada/entrevista with no update 7+ days).

## Direction contract

THESIS: GitHub Issues/Projects played straight: the job hunt as an issue tracker. Refuses dashboards of hero metrics and card grids; the list is the product.

OWN-WORLD: Primer-like neutrals, light and dark from the OS; one blue for links/focus; status and verdict colors only as labels and state icons (open green, applied purple, interview blue, closed gray, discarded red). System UI stack, 14px base, tabular numerals. 6px radius, 1px borders, no shadows except overlays.

STORY: He sees how many recommendations await, scans rows by title/labels/score, opens one in a side panel, reads why the AI ranked it, changes status in one click, sees "Salvo". Follow-ups surface as a flagged filter.

FIRST VIEWPORT: Top bar (Vagas, counts, last collection). Under it, filter bar: search input with qualifiers, filter menus, List/Board toggle. Then the list box: header row with status tabs (Recomendadas N · Interessantes · Aplicadas · Entrevistas · Todas), rows with state icon, title, labels, meta line, score at right. Clicking a row opens a right side panel (~45%) with status select as primary action.

FORM: category canon (standing exit), chosen by the user; reference GitHub Issues/Projects. Seed key 2d691a46.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
