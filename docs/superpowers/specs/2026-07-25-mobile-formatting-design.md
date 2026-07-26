# Mobile Formatting — Design

**Date:** 2026-07-25
**Status:** Proposed

## Goal

Make the app usable on phones. On small screens the race screen stacks
vertically: the **race occupies the top 2/3** (minimized to fit) and a
**scrollable results table fills the bottom 1/3**. Desktop layout (race left
3/4, results right 1/4) is unchanged.

## Breakpoint

Single breakpoint: `@media (max-width: 768px)`. Above it, the current desktop
layout applies unchanged; at/below it, the mobile rules below apply. Use `100dvh`
(dynamic viewport height) so mobile browser chrome doesn't clip the layout.

## Race screen (the core change)

Today `.race-screen` is `display: grid; grid-template-columns: 3fr 1fr` (track
left, results right). On mobile it becomes a two-row stack:

```css
@media (max-width: 768px) {
  .race-screen {
    grid-template-columns: 1fr;   /* single column */
    grid-template-rows: 2fr 1fr;  /* race 2/3, results 1/3 */
    height: 100dvh;
  }
  .race-screen__results {
    border-left: none;
    border-top: 1px solid #333;   /* divider moves to the top */
  }
}
```

- **Track (top 2/3):** the canvas already sizes itself to its container via
  `sizeCanvas()` (`getBoundingClientRect`), so it automatically minimizes to the
  2/3 height. No JS change needed for the container sizing itself — but see
  "Canvas readability" for making the *contents* fit.
- **Results (bottom 1/3):** `.race-screen__results` already has
  `overflow-y: auto`, so the panel scrolls within its 1/3 row. The divider moves
  from a left border to a top border.

## Results as a scrollable table

The results panel keeps rendering per-finisher rows (rank · thumbnail · horse ·
person). On mobile it is presented as a compact, scrollable table:

```css
@media (max-width: 768px) {
  .race-screen__results { padding: 8px 12px; }
  .results__title { font-size: 15px; position: sticky; top: 0;
                    background: #101010; padding-bottom: 6px; } /* header stays visible while scrolling */
  .results__row { gap: 6px; }
  .results__img { width: 22px; height: 22px; }
  .results__person { font-size: 11px; }
}
```

The existing DOM (an `<ol>` of rows) already reads as a table (rank column +
image + names). We keep it — no `results.ts` change — and rely on the sticky
title + `overflow-y: auto` for the "scrollable table" behavior. (If a true
column-aligned `<table>` with a header row is preferred, that's a small
`renderResults` change and can be a follow-up.)

## Canvas readability on small widths

The canvas draws a fixed 150px left gutter (names) and 40px horse tokens
(`race-canvas.ts` constants `GUTTER`, `HORSE_PX`). On a ~360px-wide phone a 150px
gutter leaves almost no track. Make these responsive to the canvas width so the
race stays legible when minimized:

- Derive them per-render from canvas width instead of hardcoding:
  - `gutter = Math.min(150, Math.max(64, width * 0.28))`
  - `horsePx = Math.max(20, Math.min(40, height / laneCount * 0.7))` (scales with
    lane height so 12 lanes fit the 2/3 area)
  - gutter font size scales likewise (e.g. `Math.max(9, Math.min(13, gutter/11))`).
- Truncate long horse names to the gutter width (canvas `measureText` + ellipsis)
  so they don't collide with the track.

This is the one JS change: turn the module-level `GUTTER`/`HORSE_PX` constants
into values computed inside `draw()` from the current `canvas.width/height`.

## Countdown overlay

120px is oversized on phones:

```css
@media (max-width: 768px) { .countdown { font-size: 64px; } }
```

## Lobby / landing on mobile

- **Lobby grid** already uses `repeat(auto-fill, minmax(230px, 1fr))`, which
  collapses to a single column on phones. Combined with the input-overflow fix
  (`min-width:0; width:100%`), the lane cards fit. Add slightly tighter padding
  on mobile (`.lobby { padding: 0 10px; }`).
- **Landing** is a centered `max-width: 420px` block — fine on mobile; just ensure
  side padding so it doesn't touch the edges.

## Out of scope (v1)

- No dedicated tablet/landscape-phone breakpoint (the 768px rule covers both;
  landscape phones get the stacked layout too, which is acceptable).
- No true `<table>` element / column headers (kept as the styled list; noted as a
  possible follow-up).
- No orientation-lock or gesture handling.

## Testing / verification

- Pure/unit: the canvas gutter/token sizing math can be extracted to a small pure
  helper (e.g. `canvasMetrics(width, height, laneCount)`) and unit-tested, like
  the existing `laneY`.
- Manual: verify on a phone-width viewport (DevTools device toolbar at ~375×667)
  that (1) race fills the top 2/3 with all 12 lanes visible and names not
  overrunning the track, (2) results scroll in the bottom 1/3 with a sticky
  header, (3) the lobby is single-column with no horizontal overflow.

## Summary of changes

- `styles.css`: one `@media (max-width: 768px)` block (race-screen rows, results
  top-border + sticky header + compact rows, countdown size, lobby padding).
- `race-canvas.ts`: compute `gutter`/`horsePx`/gutter-font from canvas
  dimensions inside `draw()`; truncate names to the gutter. Optionally extract a
  pure `canvasMetrics()` helper for testing.
- No changes to `main.ts`, `results.ts` (unless the true-`<table>` option is
  chosen), or any server code.
