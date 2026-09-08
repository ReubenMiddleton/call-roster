# Preferences and the request diary

How shift requests reach the practice principal today, what the raw input actually looks like, and
the data model that has to receive it.

This document exists because the paper diary is the **only** record of the input format, and
because "preference" turns out to conflate three genuinely different things that must not be
lumped together.

---

## The current collection process `[CONFIRMED]`

1. Doctors send shift requests by WhatsApp, ad hoc, through the month.
2. The principal transcribes them by hand into a page-per-month paper diary.
3. Around the 20th he hand-builds next month's grid.

Steps 1–2 are what the product replaces. **v1 may legitimately start with the admin entering each
doctor's preferences himself** — deliberately manual, with the self-service path documented as a
later goal. That is the principal's own stated preference and it is the right sequencing: it
removes one variable from the first month that matters.

---

## The diary page — raw input format

A photograph of the diary page dated **Monday 31 August 2026** (the working page for the September
2026 roster) is the source. It should be stored properly in `private/source-artifacts/`; it exists
nowhere else.

**Structure observed** `[CONFIRMED]`:

- One block per doctor, thirteen blocks, arranged in two columns.
- Each doctor's name carries **tick marks** — between one and three, sometimes with an extra mark.
- Below the name, **a first list of dates and ranges**: e.g. `4-6  11-13  18-20`,
  `12-13  19-20`, `26-27 ± 12+13`.
- Below that, **a second list prefixed with a three-letter token**: e.g. `NOT 23-30`,
  `NOT 12  25-30`, `NOT 22-27`, `NOT 1-7`.
- A **`±` symbol** appears in several entries.

### The second list: `NOT` means not working `[CONFIRMED]`

**Answered by the practice principal, 26 August 2026** (relayed by the project owner): the token
is **`NOT`**, and it marks **dates the doctor is not working**.

This was the highest-value open question in the whole project, because it defines the preference
data model, and it is now closed. Two consequences:

- **The handwriting is `NOT` throughout, not `MOT`.** There is one second-list type, not two.
- **The Afrikaans reading is dead.** `MOT` as *moet* ("must") was the second-most-plausible
  candidate and would have inverted the meaning of every second-list entry. Recorded here so it
  is not re-proposed.

### Still open: is `NOT` hard or soft? `[UNKNOWN]`

"Not working" does not by itself distinguish **cannot** from **would rather not**, and that is
precisely the distinction the whole taxonomy exists to preserve:

- If `NOT` means *cannot* — leave, away, another commitment — it maps to `UNAVAILABLE`, a hard
  constraint, and it consumes the doctor's unavailability budget.
- If `NOT` means *would rather not* — a stated preference the principal weighs against everything
  else — it maps to `PREFER_NOT`, a soft penalty at S-03.

The practical difference is large. Under the first reading the solver may never place a shift
there; under the second it may, at a cost, when coverage demands it. Some observed ranges are
long — `NOT 23-30`, `NOT 25-30` — which reads more like leave than like a mild preference, but
**that is an inference from range length and is not sufficient to promote the tag.**

**Interim behaviour:** ingest `NOT` as `UNAVAILABLE` **with an explicit `sourceToken: 'NOT'`
field recorded on the preference**, so that if the answer turns out to be `PREFER_NOT` the
reclassification is a data migration over a labelled set rather than an archaeology exercise. This
is the swappable-interface pattern: build up to the blocked point, do not stall, and do not lose
the ability to change your mind cheaply.

Logged in [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md).

### The first list: structural weekend availability `[CONFIRMED as to cause, 26 Aug 2026]`

In September 2026 the 1st is a Tuesday, so the Friday–Sunday weekends are 4–6, 11–13, 18–20 and
25–27. The first list for most doctors is *exactly* some subset of those triples.

Several entries also list individual midweek dates, so "weekend availability" is an approximation
rather than a definition — the list is better described as **"dates this doctor is offering to
work"**.

**And the reason it is mostly weekends is now known, which changes how it should be treated.** Most
doctors on this roster have a **primary practice elsewhere** and cover shifts here for additional
income, mainly at weekends — see [`workforce.md`](workforce.md). Their weekdays belong to someone
else.

So a pool doctor offering 4–6, 11–13 and 18–20 is **not** saying *"I would like those weekends"*.
They are saying *"those are the weekends my other practice leaves me free."* That is far closer to a
hard structural constraint than a soft wish, and treating it as a mild preference the solver may
outvote would produce rosters nobody can actually work.

**Design consequence:** a pool doctor's stated availability should carry substantially more weight
than an anchor's stated preference for the same date. They are **different kinds of statement wearing
the same notation.** Whether that is a distinct preference type or a per-doctor weight multiplier is
open — logged.

The Friday–Sunday framing of the triples also bears on the unresolved definition of **weekend** in
[`../product/glossary.md`](../product/glossary.md).

### `±` — ✅ `[CONFIRMED 2026-09-04]` — it means **"if necessary"**

Appears in entries like `26-27 ± 12+13`. The principal:

> *"It actually means 'if necessary'. I spoke to D03 and she said if absolutely necessary she could
> work on those days, so I recorded that as ±."*

**All three candidate readings were wrong**, including the owner's own relayed guess of
*"approximately"* and my preferred reading of *"alternative dates"*. It is not a fuzzy date at all —
it is a **conditional availability**: the doctor is not offering these dates, but will take them if
the roster cannot be covered otherwise.

That is a materially different thing to model, and better than any of the guesses:

- **It is a fallback, not a discount.** A `±` date should be left empty while any other doctor can
  cover it, and used before a slot goes uncovered. In penalty terms it sits **between an ordinary
  assignment and a coverage shortfall** — expensive, but far cheaper than nobody in the building.
- **The dates are exact.** `26-27` means the 26th and 27th, not "around the 26th". Nothing about the
  date parsing needs to change.
- **It is a gift, not a burden the doctor chose.** A `±` shift that gets used is close to `absorbed`
  provenance: taken on because nobody else could. It should not count against them the way a
  `requested` shift is excluded from equalisation.

✅ **Modelled 6 September 2026, and the fix was a SIGN FLIP rather than a smaller number.** Two
earlier attempts wrote it as a weight discount and could not work: a firm `PREFER` penalises *not*
assigning the date, so discounting that penalty made the solver spend the fallback **more** eagerly
the cheaper it got. The cost has to move to the other variable.

The rule, applied to every type — **`tentative` moves a preference one step toward neutral and never
past it:**

| Type | Firm | Tentative |
|---|---|---|
| `PREFER` | missing it costs 20 (S-02) | **taking it up costs 10**, reported as S-03; missing it costs nothing |
| `PREFER_NOT` | assigning it costs 30 | assigning it costs 10 |
| `UNAVAILABLE` | `LEGAL` tier, ~50,000 | **`PREFERENCE` tier, 100** — a strong objection, not a bar |
| `MUST` | H-09 | ❌ **refused at the wire.** A commitment made only if necessary is not one, and every reading of it rosters somebody against what they said |

A take-up is reported under **S-03, not S-02**: nothing was *missed*: the doctor got something they
had asked to avoid unless needed, which is what S-03 describes.

### Tick marks — `[UNKNOWN]`

One to three per name, sometimes with an extra mark. Could be submission tracking (chased once,
twice, three times), a count of requests granted, or something else entirely. Not modelled.
Logged.

---

## What the diary already proves about the data model

Independent of the open questions, the diary settles the shape of the model. The principal is
already tracking:

- **at least two semantically different kinds of request** — the first list and the `NOT` list, and
  they are not the same thing;
- **a conditional modifier** — the `±`;
- **per-doctor, per-date-range** granularity.

So the preference model needs a **type taxonomy from day one**, not a single `availability`
boolean. The rostering literature is emphatic on exactly this point: "preference" conflates
*unavailability* (hard), *undesired* (soft penalty) and *desired* (soft reward), and real products
must not collapse them.

---

## The v1 taxonomy

| Type | Semantics | Solver treatment | Diary origin |
|---|---|---|---|
| `UNAVAILABLE` | Cannot work | Hard, **budgeted** | `NOT` list, pending the hard/soft question |
| `PREFER_NOT` | Would rather not | Soft penalty, S-03 | — |
| `PREFER` | Wants this shift or date | Soft reward, S-02 | First list `[INFERRED]` |
| `MUST` | Committed to working this | Hard | — |
| `TENTATIVE` | **Modifier** on any of the above | Reduced weight, flagged in UI | `±` |

### Structured enum only — no free-text field, ever

This is a hard product boundary, not a style preference. A free-text preference box reliably
collects religious observance — *"no Friday sunset shifts"*, *"off for Eid"*, *"Sabbath"* — which
is **special personal information** under POPIA s26. That one design choice would drag the whole
system into the s57 prior-authorisation regime (four weeks, extendable to thirteen, before any
offshore transfer) and into the March 2026 Health Information Regulations.

Likewise: leave has an **administrative category**, never a *reason*. "Sick leave" as a stored
reason is health information about the data subject. See
[`../ops/compliance.md`](../ops/compliance.md).

Enforced in input validation, stated in the terms.

### The unavailability budget

`UNAVAILABLE` is capped per doctor per period. Without a cap, declaring unavailability is free and
people mark everything they would mildly rather avoid — the model then goes infeasible for
reasons nobody can see. Leave is an absence, handled separately, and does not consume budget.

The budget number is `[UNKNOWN]`. It must be set with the principal, visibly, and it must be the
same for everyone or the difference must be explainable.

---

## When natural-language intake arrives

Later, the principal will be able to paste a WhatsApp message and have structured preferences
proposed. That works — it is a well-evidenced use of an LLM — **with one mandatory guardrail**:

> **Every LLM-extracted constraint must be shown back to a human in plain language and explicitly
> confirmed before it enters the model.**

This is not caution for its own sake. Published work shows an LLM achieving a perfect optimality
gap while correctly identifying only **50% of the ground-truth constraints** — a silent false
positive. An LLM turning *"I can't work the 14th to 18th"* into a constraint will sometimes drop
or mangle it, and the resulting roster will look perfectly fine.

It is also good UX regardless: the confirmation reproduces the acknowledgement a doctor currently
gets from a thumbs-up on WhatsApp.

## What not to build

**Do not digitise the handwritten diary.** Handwriting recognition looks good on benchmarks
(~1.7% character error rate) but those benchmarks are people copying prompted sentences neatly
onto ruled lines, not a busy clinician scribbling with arrows and crossings-out. Worse, character
error rate is the wrong metric here: `14-18` misread as `14-16` barely moves it and is
catastrophically wrong.

The right question to ask the principal is *"of everything in that diary, what do you actually
need going forward?"* The answer is standing preferences — perhaps twenty or thirty facts — which
is an hour of conversation at 100% accuracy. Historical one-off requests have no forward value.
