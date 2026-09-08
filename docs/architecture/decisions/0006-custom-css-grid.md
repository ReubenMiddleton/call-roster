# ADR 0006: A custom CSS Grid for the roster matrix, not a commercial scheduler component

- **Status:** accepted
- **Accepted:** 2026-08-31 by the project owner
- **Date:** 2026-08-26
- **Deciders:** project owner (pending — Track B4)

> In the context of **rendering a month as doctors × days with a code in each cell**, facing **a field
> of commercial "scheduler" components that all model resources against continuous time**, we decided
> for **a custom CSS Grid of roughly 400–600 lines**, to achieve **exact print control and zero
> licensing exposure**, accepting **that we own the keyboard navigation, virtualisation and
> accessibility work ourselves**.

## Context

**A call roster is not an event calendar.** It is a matrix: rows are doctors, columns are days, each
cell holds a 2–3 character code. Every commercial scheduler component models *resources × continuous
time* in pixels-per-minute, which is a genuinely different problem. Forcing a month-grid out of one
means fighting its layout engine, paying four figures, and inheriting its print behaviour.

**Print behaviour is not a detail here — it is the product.** The printable monthly grid is the
artifact of record. The predicted failure mode is precise: the principal builds the roster in the app,
exports it, **rebuilds it in Word because it does not look right**, does double work, and quits.

The arithmetic is also unusually favourable. 31 columns at 40px plus a 160px name column ≈ 1,400px;
15 rows at 36px = 540px. **The whole month fits on one laptop screen with no scrolling** — the single
biggest advantage over both the paper diary and any generic calendar app. A component built for
pixels-per-minute timelines will not give that away for free.

And there is a commercial dimension. This is intended to be sold, eventually to hospital groups. A
UI licence that becomes a problem at exactly the moment the SaaS succeeds is a bad trade.

## Decision

**Build the roster matrix as a custom CSS Grid.**

```css
grid-template-columns: 200px repeat(31, minmax(44px, 1fr));
```

with `position: sticky` on the name column and the date header. Roughly 400–600 lines total.

Encode information on **four independent, non-colour-dependent channels**:

```
Cell background  = shift type (3 colours, luminance-distinguishable in greyscale)
Cell text        = doctor code (2–3 characters, bold)
Cell corner mark = constraint warning (a triangle — shape, not colour)
Cell border      = locked / manually overridden (dashed vs solid)
```

**Do not colour by doctor.** Thirteen to fifteen categories is far beyond what categorical palettes
support — the colourblind-safe Okabe-Ito palette stops at eight deliberately, and design systems warn
that categorical colour becomes hard to read past six and very hard at twelve. Colouring by shift type
and encoding the doctor as **text** is also exactly what the paper diary and the Word table already
do, so it is a paper-parity win as well as an accessibility one, and it survives both greyscale
photocopying and WhatsApp's JPEG pipeline.

**Click-to-assign is the primary interaction; drag is an optional accelerator.** Use **Pragmatic
Drag and Drop** (~3.5KB, framework-agnostic) if drag is added at all.

**For doctor-facing calendar views**, use an MIT-licensed event calendar. Those genuinely *are*
events, and a good event-calendar library is excellent at them. The decision here is about the matrix,
not about every date-shaped view in the product.

## Considered alternatives

| Option | Why rejected |
|---|---|
| **FullCalendar Premium** | **v7 moved GPLv3 → AGPLv3, explicitly closing the SaaS loophole.** From $480/year, and full redistribution needs a custom-quote OEM licence. Also models continuous time, not a matrix. *(FullCalendar Standard, MIT, is still the right choice for doctor-facing event views.)* |
| **Bryntum Scheduler** | $680/developer with a **three-developer minimum**, and SaaS distribution needs an OEM licence. Four figures before the first line of code |
| **DHTMLX Scheduler** | Its commercial tier says **"No use in SaaS"** outright. Disqualifying |
| **Syncfusion Community** | Free only while under $1M revenue / 5 developers / 10 employees. That means **re-platforming at exactly the moment the SaaS succeeds** — the worst possible time |
| **Schedule-X Premium** | €999 lifetime and one licence covers a whole SaaS — genuinely the friendliest commercial option, and the one to reconsider first if the custom grid proves harder than expected. Still models the wrong shape, and still cannot give the exact print control the export requires |
| **An HTML `<table>`** | Semantically defensible and it prints well. But sticky headers, cell-level interaction and virtualisation are all harder in a table than in Grid, and Grid's `minmax()` is what makes the no-scroll month work responsively |
| **A generic data-grid** (AG Grid, TanStack Table) | Built for sorting, filtering and paging tabular data. None of those are wanted here. Fighting a data grid to *stop* it behaving like a spreadsheet is more work than 500 lines of Grid |
| **`react-beautiful-dnd`** for drag | **Deprecated by Atlassian.** Do not use |
| **`dnd-kit`** for drag | Its next-generation packages were still at 0.5.0 as of June 2026, with open maintenance questions |

## Consequences

**Good:**

- **Exact print control**, which *is* the PDF requirement. The same stylesheet serves `@media print`
  in the browser and Playwright server-side.
- **Zero licensing exposure** when selling to hospital groups. No OEM negotiation, no revenue cliff.
- Exact keyboard navigation and colour semantics, which matters for WCAG 2.2 SC 2.5.7 — all dragging
  functionality must be achievable by single pointer without dragging unless dragging is *essential*,
  and moving a doctor from the 14th to the 15th will not win an "essential" argument. Adding keyboard
  support does **not** satisfy 2.5.7.
- The no-scroll month is protected by construction rather than fought for.

**Bad, or accepted as a cost:**

- We own accessibility, keyboard navigation, focus management and any virtualisation. At 15 × 31 cells
  virtualisation is not needed, which removes the hardest part.
- No vendor support. Acceptable for 500 lines of layout.
- Real risk of scope creep — a custom grid invites feature-building. The discipline is that **the
  export comes before the editor gets clever.**

**Revisit when:** the grid exceeds roughly 1,500 lines, or a requirement arrives that genuinely needs
continuous-time rendering (overlapping shifts, part-hour granularity, multi-site timelines). None of
those are in scope for single-cover rostering.
