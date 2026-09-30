---
name: Vagas
description: Personal job-hunt tracker, played straight as a GitHub Issues/Projects surface (Primer).
colors:
  canvas: "#ffffff"
  canvas-subtle: "#f6f8fa"
  canvas-inset: "#f6f8fa"
  canvas-overlay: "#ffffff"
  fg: "#1f2328"
  fg-muted: "#59636e"
  border: "#d1d9e0"
  border-muted: "#d1d9e0b3"
  accent: "#0969da"
  accent-subtle: "#ddf4ff"
  success: "#1a7f37"
  success-subtle: "#dafbe1"
  attention: "#9a6700"
  attention-subtle: "#fff8c5"
  done: "#8250df"
  done-subtle: "#fbefff"
  danger: "#d1242f"
  danger-subtle: "#ffebe9"
  severe: "#bc4c00"
  severe-subtle: "#fff1e5"
  neutral-subtle: "#818b981f"
  row-hover: "#f6f8fa"
  row-active: "#ddf4ff80"
  btn-bg: "#f6f8fa"
  btn-hover: "#eff2f5"
  primary-bg: "#1f883d"
  primary-hover: "#1c8139"
  primary-fg: "#ffffff"
  focus: "#0969da"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Noto Sans\", Helvetica, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Noto Sans\", Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
    fontFeature: "tnum"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Noto Sans\", Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  body-small:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Noto Sans\", Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Noto Sans\", Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "18px"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  inset: "5px"
  md: "6px"
  overlay: "12px"
  pill: "2em"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "48px"
components:
  button-default:
    backgroundColor: "{colors.btn-bg}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-default-hover:
    backgroundColor: "{colors.btn-hover}"
  button-small:
    padding: "0 8px"
    height: "28px"
  button-primary:
    backgroundColor: "{colors.primary-bg}"
    textColor: "{colors.primary-fg}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-invisible:
    backgroundColor: "transparent"
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.md}"
  button-invisible-hover:
    backgroundColor: "{colors.neutral-subtle}"
    textColor: "{colors.fg}"
  button-danger:
    backgroundColor: "{colors.btn-bg}"
    textColor: "{colors.danger}"
    rounded: "{rounded.md}"
    height: "32px"
  button-danger-hover:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.primary-fg}"
  input:
    backgroundColor: "{colors.canvas-inset}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  input-focus:
    backgroundColor: "{colors.canvas}"
  segmented-item:
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.inset}"
    padding: "0 10px"
    height: "26px"
  segmented-item-selected:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.fg}"
  label-success:
    backgroundColor: "{colors.success-subtle}"
    textColor: "{colors.success}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 7px"
    height: "20px"
  label-attention:
    backgroundColor: "{colors.attention-subtle}"
    textColor: "{colors.attention}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 7px"
    height: "20px"
  label-outline:
    backgroundColor: "transparent"
    textColor: "{colors.fg-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 7px"
    height: "20px"
  list-row:
    backgroundColor: "{colors.canvas}"
    padding: "10px 16px"
  list-row-hover:
    backgroundColor: "{colors.row-hover}"
  list-row-active:
    backgroundColor: "{colors.row-active}"
  board-card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  menu:
    backgroundColor: "{colors.canvas-overlay}"
    rounded: "{rounded.overlay}"
    padding: "8px 0"
  menu-item-hover:
    backgroundColor: "{colors.neutral-subtle}"
    rounded: "{rounded.md}"
---

# Design System: Vagas

## Overview

**Creative North Star: "The Issue Tracker, Played Straight"**

Vagas is GitHub Issues/Projects rendered in Primer, with no metaphor laid over it. The user chose the category standard deliberately: every job is an issue, every status is an issue state, the AI verdict is a label, and the list is the product. Nothing on the page is decoration; a color, icon or border exists because Primer would put it there and because it carries a state.

The surface is dense and quiet. Neutral canvases and 1px borders carry the structure; hue appears only in state icons, labels, scores and the one blue for links and focus. Light and dark themes follow the OS through `prefers-color-scheme` and can be pinned with a `data-theme` override on the root, both using Primer's own values. Motion is brief and functional: panels slide in, menus drop in, toasts rise, and all of it collapses under `prefers-reduced-motion`.

Rejected by the user during the world choice: the metaphorical worlds (post-office sorting hall, work-booklet, arcade and the rest). The category's conventions stay as GitHub ships them.

**Key Characteristics:**
- Primer neutrals, light and dark, with a `data-theme` override.
- Status and verdict colors live only in state icons, labels and scores.
- System UI stack at 14px with tabular numerals throughout.
- 6px radius, 1px borders, flat surfaces; shadows only on overlays.
- Octicons 16px, `currentColor`, as the only icon set.

## Colors

A Primer functional palette: grey structure plus five semantic hues, each with a solid foreground and a subtle tinted background. Every value has a dark-theme twin (in the sidecar's `colorMeta`) swapped wholesale by the theme selectors.

### Primary
- **Primer Link Blue** (`accent`): links, focus rings, the active filter, the row-title hover, the drop target on the board, and the `entrevista` state. The only interactive hue.
- **Merge Green** (`primary-bg`): the one primary action per panel ("Marquei que me candidatei"). Never used for anything that is not the main action.

### Secondary (semantic states)
- **Issue-Open Green** (`success`): `nova` state icon, `forte` verdict label and score, saved confirmations, highlights list.
- **Attention Ochre** (`attention`): `interessante` state icon, `avaliar` verdict label and score, the follow-up banner, gaps list, the "Cobrar retorno" tab count.
- **Done Purple** (`done`): `aplicada` state icon.
- **Severe Orange** (`severe`): the "cobrar retorno" label on rows only.
- **Danger Red** (`danger`): the Descartar buttons and error messages. Nothing else.

### Neutral
- **Canvas White / Canvas Subtle** (`canvas`, `canvas-subtle`): page and list body; top bar, box headers, board columns, button fill.
- **Canvas Inset** (`canvas-inset`): resting fill of inputs and the search field; turns to `canvas` on focus.
- **Ink** (`fg`) and **Muted Slate** (`fg-muted`): primary text and all secondary text, meta lines, idle icons, and the closed/discarded states.
- **Hairline** (`border`, `border-muted`): box and control borders; row and section dividers use the muted variant.
- **Neutral Wash** (`neutral-subtle`): tab counts, invisible-button and menu-item hover, skeletons.

### Named Rules
**The Status Color Law.** Status colors map to GitHub issue semantics and never drift: `nova` = success green (issue-opened), `interessante` = attention yellow (star), `aplicada` = done purple (check-circle), `entrevista` = accent blue (comment-discussion), `encerrada` = muted gray (issue-closed), `descartada` = muted gray (skip). AI verdicts: `forte` = success label, `avaliar` = attention label, everything else (`fila`, `descartar`, `sem`) = outline label.

**The Not-Planned Rule.** Descartada is gray, like GitHub's "closed as not planned": discarding is archiving, not an error. Red is reserved for the Descartar button and for errors.

**The Labels-Only Rule.** Semantic hue appears only as a state icon, a label, a score, or a banner tint. Surfaces, headers and columns stay neutral.

## Typography

**Body Font:** System UI stack (-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif)
**Mono Font:** ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas

**Character:** GitHub's own voice: the platform face at a compact 14px, weight doing the hierarchy work (400 and 600, 500 for labels and buttons), numerals tabular so scores and counts align.

### Hierarchy
- **Title** (600, 20px, 1.3): the open job's title in the side panel; empty-state heading.
- **Headline** (600, 16px, 1.5): row titles (15px on mobile), scores, the brand name.
- **Body** (400, 14px, 1.5): the default; panel section headings use it at 600. Job descriptions run at 1.6 line-height, capped at 75ch.
- **Body Small** (400, 13px): top-bar meta, AI summary line on rows (one line, 90ch), field grids, segmented control, "load more".
- **Label** (500, 12px, 18px line): labels, tab counts, row meta, captions, menu titles, list sub-heads.
- **Mono** (12px): job IDs and `kbd` hints (11px).

### Named Rules
**The Tabular Rule.** `font-variant-numeric: tabular-nums` is set on the body; every score, count and date aligns in columns.

**The Sentence-Case Rule.** Labels, tabs, headings and sub-heads are sentence case in pt-BR. No uppercase tracking.

## Layout

A single 1440px-max column. Top bar (12px / 24px padding) over a main area padded 24px. Under the top bar, a sub-nav row holds the search field (with qualifiers and a `/` shortcut) and the List/Board segmented control, gap 8px, 16px above the list box.

The list box is GitHub's Box: a subtle header row with status tabs on the left and filter menus on the right, then rows on a four-column grid (16px checkbox, 16px state icon, flexible main, auto score column), 10px / 16px padding, separated by muted hairlines. Checkboxes appear on hover or while selecting.

Selecting a row opens a side panel on the right (min(46%, 640px), full height, sticky). Below 1012px it becomes a fixed overlay drawer; below 768px it goes full width, the top bar wraps, row checkboxes and summaries hide, buttons swap to short labels, and padding drops to 16px.

The board view is a horizontal grid of status columns (min 260px, 12px gap), each a subtle rounded column holding 8px-gapped cards.

Spacing runs on a 4px base: 4, 8, 12, 16, 24, 48, with 6px and 10px used inside controls exactly as Primer does.

## Elevation & Depth

Flat by default. Depth comes from tonal steps (canvas, subtle, inset) and 1px borders. Shadows appear only on elements that float above the page.

### Shadow Vocabulary
- **Overlay** (light `0 1px 3px #1f232812, 0 8px 24px #42474e2e`; dark `0 0 0 1px #3d444d, 0 8px 24px #010409`): menus, toasts, and the side panel when it becomes a drawer below 1012px.

### Named Rules
**The Overlay-Only Rule.** A shadow means "this floats". Rows, cards, boxes, columns and buttons never carry one; hover is shown by fill or border change.

## Shapes

Gently rounded rectangles everywhere (6px): buttons, inputs, boxes, cards, columns, banners, focus rings. Overlay menus round to 12px, matching Primer overlays. Labels and counts are full pills (2em). The segmented control sits in a 6px track with a 2px inset and 5px inner items, Primer's SegmentedControl geometry. Borders are always 1px; the `kbd` hint carries Primer's 2px bottom border as its native key shape.

## Components

### Buttons
Primer buttons: compact, bordered, quiet until they matter.
- **Shape:** 6px radius, 1px border, 32px tall (28px small), 12px horizontal padding, 500 weight, Octicon leading at 6px gap in muted color.
- **Default:** subtle fill (`btn-bg`) with `btn-border`; hover darkens the fill. 120ms ease-out background transition.
- **Primary:** Merge Green fill, white text; one per panel.
- **Invisible:** transparent, muted text; neutral wash on hover. Used for icon buttons in the top bar and secondary bulk actions.
- **Danger:** default button with red text; fills red with white text on hover. Only for Descartar.
- **Disabled:** muted text, 60% opacity, not-allowed cursor.

### Labels
- **Style:** 20px pill, 12px/500, 7px horizontal padding. Semantic variants use the subtle fill, solid text, and a border mixed 35% from the solid hue.
- **Variants:** success, attention, done, accent, severe, danger, outline (hairline border, muted text for workplace, level, techs and non-strong verdicts).

### State icons
16px Octicons in the status color, placed before the title in rows, cards, column heads, menus and the status button. The icon is the status; see the Status Color Law.

### List box and rows
- **Box:** 1px border, 6px radius, subtle header with tabs (count pills) and text-button filters; attention tabs tint their count yellow.
- **Row:** hover to `row-hover`, selected to `row-active`, keyboard cursor as a 2px inset focus outline. Title turns blue on hover. Score sits at right in headline weight, colored by verdict; a pre-score shows muted with a "pré-nota" caption.
- **Bulk bar:** accent-subtle strip under the header when rows are selected.

### Inputs / Fields
- **Style:** inset fill, 1px border, 6px radius, 6px / 10px padding; the search field is a 32px flex row with a leading icon and `kbd` hint.
- **Focus:** border and a 1px outline go focus-blue, fill lifts to canvas.
- **Hints:** 12px muted line under a field; green "Salvo." on save, red on error.

### Navigation
- **Tabs:** text tabs, muted at rest, `fg` on hover, 600 when selected, each with a neutral count pill.
- **Segmented control:** List/Board, selected item on canvas with a border and 600 weight.

### Side panel
Sticky header (title, sub-line, action row with the status button, primary action and Descartar) over sections divided by muted hairlines. Section heads are 14px/600 with an optional muted aside. Field grids pair muted `dt` with `dd`. AI highlights use green check icons, gaps use yellow alert icons, each list introduced by a 12px/600 muted sub-head.

### Board cards
Canvas card, 1px border, 6px radius, 8px / 10px padding, grab cursor; border strengthens on hover, turns accent when active, 40% opacity while dragging. Columns turn accent-subtle with an accent border as drop targets.

### Menus and toasts
Menus: overlay canvas, 12px radius, overlay shadow, 120ms drop-in; items are 6px-rounded rows with a check tick for the selected value and a muted count at right. Toasts: bottom-left stack, 6px radius, overlay shadow, green check or red alert icon.

## Do's and Don'ts

### Do:
- **Do** follow the Status Color Law exactly; a new status gets a GitHub-meaningful Octicon and one semantic hue.
- **Do** keep Descartada gray and reserve `danger` red for the Descartar button and errors.
- **Do** read every color from the custom properties so light, dark and the `data-theme` override stay in sync.
- **Do** use Octicons at 16px with `fill: currentColor` for every icon.
- **Do** keep surfaces flat with 1px borders and 6px radius; shadows go on menus, toasts and drawers only.
- **Do** use the system UI stack at 14px with tabular numerals.

### Don't:
- **Don't** put semantic hue on surfaces, headers or columns; it belongs in icons, labels, scores and banners.
- **Don't** add a metaphor, custom display face or decorative illustration; the category standard is the chosen world.
- **Don't** hard-code colors that bypass the theme variables.
- **Don't** use a shadow to show hover or selection on rows, cards or buttons.
