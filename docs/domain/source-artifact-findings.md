# Findings from the primary source

**Dated record of what the roster images and diary photograph actually show, compared with what the
project brief's summary claimed.** Written 26 August 2026, on first sight of the source material
(task B2).

This document exists because the brief was a *summary* of these artifacts, written in an earlier
session. Summaries lose things. Everything below was found within minutes of looking at the primary
source, which is the argument for
[`worked-examples.md`](worked-examples.md) being written from the images and not from the summary.

**Read alongside [`constraints.md`](constraints.md).** Where the two disagree, this document is
closer to the source — but nothing here is `[CONFIRMED]` until the practice principal says so, and
several items are now questions in [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md).

**Material available:** 17 unique monthly roster exports spanning **April 2025 to August 2026**,
plus one photograph of the September 2026 request diary page. Note: that is **15 distinct months**,
not 17 — April 2025 appears twice on two different templates, and April 2026 appears twice
byte-identically. **May and June 2025 are absent from the set.**

> **All fifteen months have since been transcribed** into `private/seed-data/` and verified
> arithmetically. `npm run seed:analyse` checks every catalogued constraint against all 1,430
> assignments, and the results supersede the eyeball findings below: **H-04, H-05, H-06 and H-07 are
> all falsified**, not just H-05 and H-07. See [`constraints.md`](constraints.md).

---

## 1. ⚠️ H-05 has a counterexample. It is not an absolute rule.

**The brief said:** *"D02 is never assigned a Saturday shift `[CONFIRMED]`. Source: principal
interview + zero counterexamples in 16 months."*

**The source shows:** D02 assigned a **Saturday afternoon shift on 22 August 2026.**

Checked against other months: no D02 Saturday in July 2025 or July 2026, so it is genuinely rare —
but "rare" and "never" are different constraints, and only one of them is safe to enforce.

**Why this matters more than the fact itself.** H-05 was catalogued as a hard constraint on the
strength of "zero counterexamples". Had it shipped with mode `BLOCK`, **the app would have refused to
let the principal build a roster he had actually built himself.** That is the precise failure mode
the project's "warn and scar, never block" principle exists to prevent, and it very nearly arrived
via a `[CONFIRMED]` tag that was not warranted.

The solver prototype already treats H-05 as elastic — a named slack at the legal tier rather than a
structural constraint — so the model would have produced this roster and merely flagged it. That was
the right call for reasons that turned out to be better than the ones given for it at the time.

**Action:** H-05 stays in the catalogue, mode **WARN**, never BLOCK. Its tag needs revisiting with
the principal: is it a strong preference he occasionally overrides, or was 22 August an error?
Logged.

## 2. The Thursday anchor pattern is wrong in the summary

**The brief said:** *"Thursday | D04 morning | D02 afternoon | D01 night | `[CONFIRMED]` — the most
stable day in the entire dataset."*

**The source shows** Thursday morning **alternating between D03 and D04**:

| Month | Thursday mornings, in order |
|---|---|
| July 2025 | D03, D03, D03, D03, D03 |
| July 2026 | D03, D03, D04, D04, D04 |
| August 2026 | D04, D03, D03, D03 |

Thursday **afternoon (D02)** and **night (D01)** are, by contrast, genuinely rock solid across all
three months checked — so the "most stable day" claim holds for two of the three slots.

**Consequence:** Thursday morning is not a single-holder recurring slot. It is either two overlapping
recurring slots, or a rotation between two doctors. Either is expressible in the temporal model, but
they are different data. Do not encode D04 as *the* Thursday-morning anchor.

## 3. The anchor pattern has routine exceptions — S-05 must stay soft

Even the slots the brief described as fixed vary:

- **Monday morning** is normally D03, but D04 held it on 13 July 2026.
- **Monday night** is normally D02, but a pool doctor held it on 6 July 2026.
- **Public holidays do not fully abandon the pattern.** On the observed Women's Day holiday
  (10 August 2026, highlighted red in the source), two of the three Monday anchor slots were
  retained and only the morning changed hands. The brief said holiday assignment *"abandons the
  weekday anchor pattern"* — too strong. It is varied, not abandoned.

**Consequence:** the anchor pattern is a **strong default with regular exceptions**, which is exactly
what S-05 models as a soft preference. Any temptation to harden it should be resisted; the source
does not support it.

## 4. The export is a CALENDAR, not a doctors × days matrix

**This is the most consequential finding for the build order**, and it is a shape mismatch rather
than a data error.

Every one of the 17 exports has the same layout, produced in a Word table:

```
  Sun      Mon      Tue      Wed      Thu      Fri      Sat        <- 7 columns
+--------+--------+--------+--------+--------+--------+--------+
| 6      | 7      | 8      | 9      | 10     | 11     | 12     |   <- date, top-right
| Name  7-15    ...                                            |   <- 3-4 lines of
| Name  15-23   ...                                            |      "Name  time"
| Name  23-7    ...                                            |
+--------+--------+--------+--------+--------+--------+--------+
```

Five or six week rows. Leading and trailing cells spill into the adjacent months (e.g. the July 2026
sheet shows 2 August in its first row and 1 August in its last). A practice logo and name sit in a
banner above. Public holidays are marked by outlining the date number in red.

**The brief and [`../product/prd.md`](../product/prd.md) both specify doctors-as-rows ×
days-as-columns**, on the reasoning that a whole month then fits on one screen with no scrolling.
That reasoning is sound **for the editor**. But the artifact of record is a calendar, and the brief's
own strongest warning is that if the export does not look right he rebuilds it in Word and quits.

**Consequence — and this needs a decision, not an assumption:** the editor and the export may need
*different* layouts. A month matrix is better for assigning; a calendar is what he distributes. That
is more work than one grid, and it changes C-01/C-02 in the PRD. Logged as a question.

---

## 5. The request diary — refinements

The September 2026 diary page is legible and mostly confirms the documented model. Three
refinements:

**The token really is written both ways.** Some entries clearly read `NOT`, others clearly read
`MOT` or `MoT`, in the same hand on the same page. The principal has confirmed the *meaning* is "not
working", so the working conclusion is one token written inconsistently rather than two tokens — but
the ambiguity was real and is now explained rather than resolved away.

**The first list is not purely weekend availability.** For September 2026 the Friday–Sunday weekends
are 4–6, 11–13, 18–20 and 25–27, and most entries are subsets of those. But several also list
individual weekdays (a 2nd, a 9th, a 16th, a 24th — all midweek), and one lists a five-day span.

So the first list is better described as **"dates this doctor is offering to work"**, which is
*mostly* weekends because weekdays are already covered by the anchor pattern. The `[INFERRED]`
"weekend availability" reading is a good approximation, not the definition. This also bears on the
unresolved definition of "weekend" in [`../product/glossary.md`](../product/glossary.md).

**Two doctors have no first list at all** — only a "not working" line. Both are anchors. That is
neat supporting evidence for the anchor/pool distinction being real and emergent: an anchor's
weekdays are already fixed, so the only thing they need to state is when they are away.

**Tick marks** remain `[UNKNOWN]`: between one and three per name, most commonly two, some with an
extra scribble. No pattern is inferable from a single page.

**One genuine oddity worth asking about:** at least one doctor lists the same date range with a `±`
in *both* the availability list and the "not working" list. That is either a correction in place, a
distinction the notation carries that is not visible, or a slip. Logged.

---

## What this exercise establishes

Two `[CONFIRMED]` claims were wrong (H-05's absoluteness, the Thursday holder), one was too strong
(holidays abandoning the anchor pattern), and one structural assumption about the deliverable
(matrix vs calendar) does not match the artifact.

None of that is a criticism of the brief — it is what summaries do. It is the reason the project's
rule is that `[CONFIRMED]` requires a human source or **multiple independent months**, and the reason
`worked-examples.md` must be written from these images before the solver is taken seriously.

The most useful conclusion: **the practice's rules are softer than any summary of them.** Every
"never" checked so far has an exception. That is a strong argument for the warn-and-scar design and
against every temptation to harden a constraint because the data looks clean.
