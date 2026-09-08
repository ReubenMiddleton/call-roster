# Needs your input

A running queue of points where autonomous work hit something that genuinely needs the project
owner's decision, credentials, account access, or the practice principal's domain knowledge — not
something to guess at.

When work is blocked on one of these, it is logged here with enough context to resume immediately
once resolved, and **work continues elsewhere rather than stalling**. Newest first within each
section.

## How to read this file

- **⛔ Blocked — decide before proceeding** — something downstream is genuinely waiting.
- **Open questions** — logged, not blocking. Work continues behind a swappable interface, and the
  tag stays `[INFERRED]` / `[ASSUMED]` / `[UNKNOWN]` until answered.
- **Resolved** — kept with the date and what was decided, never deleted, so the reasoning survives.

**A tag is never promoted without a human source.** An `[ASSUMED]` hard constraint that turns out to
be wrong is the most likely way this project produces a roster the principal rejects.

---

## ⛔ Blocked — decide before proceeding

**Nothing is blocked.** ✅ The one entry here — *"the sixteen roster images exist nowhere on disk and
they are the entire evidence base"* — was resolved on 26 August 2026 and the section was never
cleared. `private/source-artifacts/` holds **18 images**, `private/seed-data/` holds **33 transcribed
months**, and [`domain/worked-examples.md`](domain/worked-examples.md) was written from them. The
solver acceptance test it named has since been run twice against the practice's real September.

⚠️ **A stale blocker is worse than no blocker**: it tells a cold session to stop when nothing is
stopping it. Checked 7 September 2026.

---

## ✅ ANSWERED — nine more, 7 September 2026 (evening)

| # | Answer | What it changed |
|---|---|---|
| **Pilot** | ⭐ **October 2026** is the first real month the solver is tested on | Sets every date below. ⚠️ **The pilot must not depend on the app existing** — see the note |
| **G** | **Yes**, the January 2019 sheet is still the template in use | The export is measured against the right artifact. Question G closed |
| **Overrides** | ⭐ **Two different causes, and one of them is not an override at all** — see below | Changes what the September comparison measures, and validates the product |
| **Edit shape** | *"He moves one doctor to a different slot and then reassesses."* | **One cell at a time, then re-read.** The L1 journal records single moves, not swaps or batches, and warnings must update after each one |
| **38** | **90 days** for diagnostics | Settled. The command journal still never expires — it is the audit trail |
| **42 + noise** | ⭐ **Stable by default, with "show me another"** — plus history and **locking**. See below | The largest product decision since the export |
| **8** | **Offshore accepted for the pilot, provided it is free** | ✅ Free-tier facts verified 8 September — a keep-alive ping is required, not optional — see below |
| **9** | Docker: *"if there is no real benefit then we don't need it"* | **Not installed.** Recommendation recorded below |

### ⚠️ The published roster is not always what happened

Of September's three apparent preference overrides, **only two were overrides**:

| | What actually happened |
|---|---|
| **D05, 7 Sept** | ❌ **Not an override — a mistake on the sheet.** *"My dad made a mistake when writing up the roster; the doctor never ended up working. D03 and D06 filled the gaps."* The printed sheet says D05; reality was D03 and D06 |
| **D09, 25 Sept** and **D11, 26 Sept** | ✅ Genuine — both **changed their minds after the diary was written** |

**Three consequences, and the first is the big one.**

1. ⚠️ **The seed data records what was PUBLISHED, not what was WORKED.** All 33 months are transcribed
   from sheets, and at least one sheet is now known to be wrong about reality. The fairness ledger,
   every load ratio and every constraint verdict inherit that. **Nothing here can detect it** — only
   the principal knows. Not a reason to distrust the data, which agrees with itself across 3,199
   assignments; a reason never to claim it is ground truth about *hours worked*.
2. ⭐ **This is the clearest case yet for the product, and it arrived by accident.** The app would
   have shown *"D05 stated unavailable on 7 September"* **before the sheet was distributed**. A
   warning nobody can miss is exactly what "warn and scar" is for, and here is a real month where it
   would have paid.
3. **The diary goes stale.** Two doctors changed their minds after it was written, so the poll needs
   a stated cut-off and a way to record a late change — otherwise the request diary and the roster
   drift apart silently.

⚠️ `private/actual-2026-09.json` is a **faithful transcription of the sheet** and is left unchanged:
it is the comparison target, and the target is what the practice published. One of its 94 cells is
known not to match reality.

### ⭐ 42 — lock-and-regenerate, and the engine already supports it

> *"He can lock shifts so that the regenerate button doesn't affect those shifts… generate a roster,
> lock the shifts that are correct, and regenerate while keeping the locked shifts, locking the new
> shifts the solver got correct again, and reiterate until the whole roster gets built this way."*

**This is the best product idea in the project so far, and three things make it unusually cheap:**

1. ✅ **It is already built in the solver.** [H-13](domain/constraints.md#h-13-a-locked-assignment-is-honoured-exactly-confirmed-by-construction)
   landed 7 September — `lockedAssignments` is structurally hard, and the two payloads that could
   make it unsatisfiable are refused at the wire. **This needs UI, not solver work.**
2. ✅ **It matches how he already works.** He moves one doctor and reassesses. Lock-and-regenerate is
   the same loop with the solver doing the moving.
3. ⭐ **It is a far better learning signal than a passive edit**, and it fixes the attribution problem
   [ADR-0016](architecture/decisions/0016-learn-weights-from-edits-not-rules.md) has to work around:
   **a lock is an unambiguous "this is right", labelled by construction**, with nobody prompted for a
   reason.

**Two failure modes to design against, both cheap to prevent:**

- ⚠️ **Locking can paint into a corner.** Lock twelve cells and the remainder may be unsatisfiable or
  awful, with no visible cause. **The pre-flight arithmetic already exists** — run it on the locked
  set *before* regenerating: *"with these locked, D07 can take one more shift and three remain."*
- ⚠️ **"Show me another" runs out.** Each lock shrinks the problem, so late rounds may have exactly
  one answer. It must say *"this is the only roster left that satisfies your locks"* rather than
  silently returning the same one.

**On the history depth:** he asked for at least three. **Keep every candidate from the session
instead** — a roster is 94 rows, storage is nothing, and "at least 3 deep" is a limit invented to be
polite about cost that does not exist.

### ✅ 8 — offshore is fine; the free-tier facts are now verified, not just flagged

Accepted for the pilot on cost grounds, which is the right call: one practice, no procurement, and
POPIA s72(1)(a) is disjunctive so a drafted agreement satisfies adequacy on its own.

**Verified 2026-09-08**, against Supabase's own docs and pricing page (sources in
[`ops/supabase-setup.md`](ops/supabase-setup.md)):

- A Free-plan project pauses after **7 days** with too little database activity. **A monthly solve
  is nowhere near enough to prevent it** — the worst case the earlier note flagged is confirmed, not
  hypothetical. A paused project keeps its data and can be restored from the dashboard for up to a
  year, so nothing is lost, but **a scheduled keep-alive ping is required, not optional** — logged as
  follow-up work in `supabase-setup.md`, needs a live project and somewhere to run from.
- **Free tier allows 2 active projects per organization** — exactly what the plan needs (prod +
  synthetic tester), no multi-organization workaround required.
- **Nearest region is Frankfurt (`eu-central-1`)** — Supabase has no South Africa region, and of the
  17 AWS regions it does support, Frankfurt is the one a South African commenter on the still-open
  [community request](https://github.com/orgs/supabase/discussions/34614) names as their own closest.

**Still genuinely for the owner: creating the two projects themselves.** That is account creation
and cannot be done on his behalf. [`ops/supabase-setup.md`](ops/supabase-setup.md) is the exact,
minimal step-by-step for it.

---

## ✅ ANSWERED — seven from the owner, 7 September 2026

| # | Answer | What it changed |
|---|---|---|
| **36** | **Drop `fte`.** | Gone from [`architecture/data-model.md`](architecture/data-model.md) **before the first migration ever ran**. ADR-0008 still shows it, deliberately — an ADR records a decision at a date, not a live schema |
| **37** | **All five signed off**, 0013–0017 | Status `accepted`. **0016 gained a step on his own suggestion** — see below |
| **25** | **Yes, they know.** *"It is something I speak to my dad about regularly and he has mentioned to the other doctors that I am building this program."* | Unblocks **Track B1** (`git init` and the first push). The irreversibility was the only reason this was time-sensitive |
| **46** | ⭐ **One rule.** *"Although there are exceptions at times, the general rule is that all GPs will be unavailable on Saturday mornings."* | **The Saturday-morning exclusion is now DERIVED, not listed** — see below |
| **44** | **Change the ask from "want" to "can", and collect a cannot-work list alongside it**, through the monthly WhatsApp poll | The right direction, with one design change to avoid a trap — see below |
| **47** | Brother will pick a **freely distributable** font as part of the refresh, in the next few weeks | Nothing to build. The substitution stays a branding parameter |
| **45** | **No company yet.** Pilot with the practice through the rest of 2026; register early 2027 once the product stands up. *"Since we definitely do plan on forming a business I think it might be best to set everything up now that we will need once we move over to a business model."* | No POPIA operator agreement needed **yet**, and the seams that would be expensive to retrofit are already ADR-0010's whole subject |

### ⭐ 46 — six facts became one rule, and it now predicts the seventh GP

Measured before acting, over 146 Saturday mornings in 33 months:

| | Saturday mornings worked |
|---|---|
| D07, D08, D09, D10, D11, D12 | **zero, all six** |
| D13, D06 | 9 and 6 — about one every four or five months each |
| The anchors (D01–D05) | 125 of 146 = **86%** |

That spread is exactly *"one rule, although there are exceptions at times"*, so it is now derived
rather than listed against six codes.

⚠️ **Derived from the mechanism, not from a role.** `private/doctor-codes.md` records that *"Anchor
and Pool are descriptions, not roles — they must not become an enum in the schema."* So the rule
attaches to the fact that already drives **H-10**: a doctor who never works a weekday before 17:00
is at their own surgery, and **a GP surgery is open on a Saturday morning.** One fact, two
consequences, instead of two coincidences. The set is now the eight GPs rather than six, and it will
include a ninth automatically.

⚠️ **This is an inference on top of an inference** and is stated plainly for that reason — though
H-10's own membership rests on 68–155 shifts per doctor with **zero contradictions**. Elastic either
way, so a wrong inclusion scars rather than blocks. D06 and D13's fifteen historical Saturday
mornings are now *meant* to register as exceptions.

### ⚠️ 44 — the "cannot work" half is the valuable half, and the "can work" half has a trap

His proposal is right about the direction: today the doctors send what they **want**, and fairness
divides burden by what each **could** have worked, inferred from what they were *seen* working. That
is self-confirming, and no amount of history breaks the loop.

**The trap is in the first list, not the second.** Today the diary's availability list is modelled as
`PREFER` — a wish, deliberately not exhaustive. `private/preferences-2026-09.json` says why:

> *"Reading it as 'available on these dates and no others' would silently make every unlisted date
> unavailable, which is a far stronger claim than the diary makes and would distort the whole
> month."*

Rename it from *want* to *can* and it becomes exhaustive — **an unlisted date now means
unavailable.** A doctor who writes "4–6, 11–13" meaning *"these suit me"* would never again be
offered the 18th. That is the same self-confirming loop, arriving faster.

**Recommendation — three states, with the default stated on the poll itself:**

| Ask | Becomes | Effort for the doctor |
|---|---|---|
| **"Dates you cannot work"** | `UNAVAILABLE` | Low. People know what they cannot do |
| **"Dates you would particularly like"** | `PREFER` | Low, and optional |
| **Everything else: available** — printed on the poll | neutral | **Zero, and that is the point** |

Nobody has to enumerate anything, and the unlisted dates have a *stated* meaning rather than an
inferred one — which is the whole gain he is after. **The cannot-work list is the half that carries
the new information**; the can-work list only helps if it is exhaustive, and asking people to
enumerate every date they could work is a large ask they will do badly.

⚠️ **Dates only, never reasons.** POPIA s26 — a free-text box reliably collects religious
observance. Tick boxes and date pickers, and the poll must not have a "why?" field.

⚠️ **Declared availability must take precedence over `inferAvailability`** once it exists, or the
inference will keep overriding the answer it was a stand-in for.

### ⭐ 37 — the owner's addition to ADR-0016: ask the user questions

> *"Is there possibly a way to prompt the user with questions, give them a few options to choose
> from and ask them to choose the most correct answer."*

**Accepted, and it is stronger than "extra data".** This is *active learning*: we choose what to ask,
so the question can target the weight the fit is least sure of, and a pairwise answer has none of an
edit's attribution ambiguity. It moves the useful horizon from 6–12 months toward the 3–4 he
estimated. Recorded as step 4 of
[ADR-0016](architecture/decisions/0016-learn-weights-from-edits-not-rules.md), with the form it has
to take — **concrete pairwise comparisons, never abstract questions** — and a hard budget of two or
three a month.

---

## ✅ ANSWERED — the sit-down happened, 4 September 2026

**Eighteen questions asked, eighteen answered.** The list they answer is kept below. What each one
changed:

| # | Answer | What it changed |
|---|---|---|
| **1** | Codes confirmed | Question 32 closed |
| **2** | ⭐ **The weights, in his own numbers.** Weekday from 15:00 **1.75** (was 1.0); Sunday **3.0** (was 3.5); public holiday **4.0** (was 5.0); Christmas/NY night **6.0** (was 8.0); night 2.5 and long day 1.5 unchanged | **Question 35 closed — the largest single uncertainty in the objective.** `AGREED_BURDEN_V2`, `[CONFIRMED]`. Gini moved only 0.179 → 0.183 |
| **3** | **Friday from 17:00 prices at 3.0**, with Saturday and Sunday | Question W closed. ~120 shifts move a band |
| **4** | Sunday night = Sunday morning: correct | Question S closed |
| **5** | Holiday on a Sunday counts once, as a Sunday: correct | Symmetry with Saturday confirmed |
| **6** | ⭐ **Three months confirmed** — *and he does not see the spread as an imbalance*: D01–D04 are anchors and work more by design | Question 43 closed. `LEDGER_WINDOW_MONTHS = 3` promoted to `[CONFIRMED]` |
| **7** | Yes to declared availability. Proposes a WhatsApp poll | Question 44 closed in principle. ⚠️ **See the POPIA note below** |
| **8** | The August 2024 Friday change **was arranged, both agreed** | Question AA closed |
| **9** | D03's Tuesday doubles **were a standing arrangement** | The H-02 counterexamples are explained |
| **10** | D07/D09 Monday alternation was **cover during leave**, not standing | Question X closed — **do not model it as a recurring slot** |
| **11** | ⭐ **Monthly maxima**: D06 4, D08 4, D11 5, D12 4, D13 4; **minimum 2 for everyone**; explicitly **not hard** | New constraint **H-12**. Question U closed |
| **12** | D02's Saturday was a genuine exception; she can work them in exceptional circumstances | Question B closed. ⚠️ **See the POPIA note below** |
| **13** | ⭐ **`±` means "if necessary"** — not "approximately", not "alternative dates" | Question 5 closed, and **every prior guess was wrong**. See [`domain/preferences.md`](domain/preferences.md) |
| **14** | **Doctors only**, no employed staff | Compliance posture stays simple |
| **15** | ⭐ He would call them **"Variant" months** | Question 41 closed. In the glossary |
| **16** | 15 December 2023 was **a national holiday but the practice did not treat it as one** | Question 40 closed. The transcription's `isPublicHoliday: false` is **correct** — and the structural inference that said otherwise was wrong |
| **17** | **December is always a struggle**, roughly the 15th to New Year | Question Z closed. **The roster data said otherwise** — see below |
| **18** | **Requests due by the 15th.** First roster is usually right; tweaks only when a doctor's own information was wrong | Questions Y and Y2 closed. Change-request volume is **low** |

**Plus, unprompted, the thing he most wanted on the record:**

> *"The fairness scale is very important to him and the practice, and the fact that all the public
> holidays throughout the year are shared by the doctors so that the same small handful of doctors
> don't cover the public holidays every year."*

**That is S-08**, one of the three unmodelled soft constraints, and he has just made it the priority
among them.

### ⚠️ The one thing to be careful about: religious exclusions

Answer 12 gives a religious reason for D02's Saturday exclusion, and answer 7 proposes that the
principal **record** the doctors' religious exclusions.

> **Record the exclusion; never record the reason.**

*"D02 cannot work Saturdays"* is an availability constraint and is fine. *"…because of her religion"*
is **special personal information under POPIA s26**, which triggers s57(1)(d) — prior authorisation
from the Information Regulator before any offshore transfer, four weeks and extendable to thirteen.
The database is hosted offshore. It would stall the project outright.

Nothing changes operationally: the principal already knows the reasons and always has. They stay
with him. The poll asks *which shifts can you work*, never *why not*, and carries **no free-text
box** — which is already an enforced product boundary. See [`ops/compliance.md`](ops/compliance.md).

### ⚠️ Two places his answers contradicted the data, and he is right both times

- **Question 16.** The roster *structure* said 15 December 2023 was a holiday — of 144 Fridays,
  Pattern A appears on eight, and seven of those eight are confirmed holidays. The eighth was that
  date. **He says the practice did not treat it as one.** The inference was reasonable and wrong,
  and the transcribed `isPublicHoliday: false` was right all along. **A structural signal is not a
  source**, which is exactly why the confidence tag was never promoted.
- **Question 17.** The data showed the December shortage in **2023 only** — December 2025 had *more*
  doctors working than an average month. **He says December is always a struggle, mid-month to New
  Year.** Both are true: rosters record who *worked*, never who *asked to be away*. He is describing
  leave requests, which no roster sheet contains. The capacity feature should key on **mid-December
  to New Year**, as he says.

---

## ☀️ The questions asked at that sit-down — 4 September 2026

**Supersedes the 1 September list below**, which is kept for the answers it records. Ordered by what
each one unblocks. **Nothing here blocks code** — everything has a safe default and work continues
around it. If you only get through the first section, that is the right first section.

### 🥇 Collect these — they are worth more than any answer

| # | What | Why it is first |
|---|---|---|
| **G** | ✅ **ARRIVED 2026-09-06** — the January 2019 roster as a `.docx`, plus the letterhead PDF. Both in `private/template/source/`; a blanked template and the extracted logo sit beside them. **One thing still to ask: is this the same file today's sheets come from?** It is four years older than the nineteen photographed ones | Was the single biggest risk in the project. Column widths, print size, the greys and how a long name wraps are now **measured**, not inferred — see [*What the Word source settles*](product/export.md#what-the-word-source-settles). The renderer is unblocked, and so is your brother |
| **32** | **Confirm the D01–D16 mapping** in `private/doctor-codes.md`. He approved the *scheme*, never the pairs | Five seconds. 3,145 assignments and every fairness figure are keyed to these codes, and they are permanent once confirmed |
| — | **The December 2023 sheet image**, if he still has it — see question 40 | Settles a burden weight on a Friday, and it is the last unexplained divergence in the holiday calendar |

### 🔢 The four that change every fairness number

These are one conversation, not four. **Do not let him answer them quickly** — a weight nobody
agreed to is a weight nobody accepts when it produces an unwelcome roster.

| # | What to ask | Why it matters |
|---|---|---|
| **35** | ⚠️ **Agree the burden weights with him.** The current table is `[ASSUMED]` — weekday day 1.0, weekday night 2.5, Saturday 3.0, Sunday 3.5, public holiday 5.0, Christmas/New Year night 8.0, long day 1.5 | **The largest single uncertainty in the whole objective.** Every load ratio, the ledger and the solver's fairness term all multiply through these. The social half matters as much: this is the number the group has to accept |
| **W + V** | **There is no Friday row.** He confirmed the weekend starts Friday 17:00, but a Friday night still prices at 2.5 and a Friday evening at 1.0 — the same as a Tuesday. Should they price at the Saturday rate? | About 120 shifts move between bands, enough to reorder the fairness table. And it decides *who*: **D02 worked 103 Fridays, D03 88, D04 64, D01 only 29** — under-pricing Friday under-credits three of the four doctors already showing as most loaded |
| **S** | **Is a Sunday night harder than a Sunday morning?** The table prices them identically, which is almost certainly wrong. Same for a public-holiday night | Two rows in a table. Currently a guess |
| — | **A public holiday falling on a Sunday** — counts once, as a Sunday? He confirmed that for Saturday; Sunday is my inference by symmetry, not his answer | One word. Affects Easter and every December |

### ⚖️ Fairness — the two that decide what "fair" even means

| # | What to ask | The numbers to show him |
|---|---|---|
| **43** | ⚠️ **Confirm the three-month window.** You relayed *"a new beginning… only the previous 3 months"*, and the code is built to it, tagged `[ASSUMED]` because it is your reading rather than his answer. **Three months, or another span?** | Over the full 33 months: **D02 is 50% above a fair share, D01 49%, D03 20%, D04 19%** (Gini 0.179). Over three months the picture is much smaller and correctable — which is exactly why the span matters. ⚠️ **He may say it is not an imbalance at all**, and that carrying more is deliberate. That answer is equally useful and should not be argued with |

### 📋 Rules — was this agreed, or did it just happen?

Each of these is a pattern the data found. **The data answers *what*; only he answers *why*** — and
the why decides whether the solver holds the pattern or lets it drift.

| # | What to ask |
|---|---|
| **AA** | **D01 worked 53% of Pattern B Fridays before August 2024 and 9% after**, when the Friday early shift passed to D04. Was that agreed between you, or did it just happen? |
| **New** | **Did D03 formally hold both Tuesday 15:00–23:00 and Tuesday 23:00–07:00 through 2024?** Every Tuesday in January, May, June and July — 34 doubles over eight months, stopping in August 2024 when D04 took the night |
| **X** | **D07 and D09 alternate the Monday 15:00–23:00 shift fortnightly** — the only two exceptions to "GPs cannot work before 17:00", 13 of 1,086 pool shifts, all Mondays. A standing arrangement? |
| **U** | **Does any doctor have a target number of shifts a month, or a contracted commitment?** |
| **B** | **D02 worked a Saturday afternoon on 22 August 2026.** An exception he chose, or a mistake? |

### ✅ Quick ones — a word each

| # | What to ask |
|---|---|
| **5** | **What does `±` mean in the diary** — as in `26-27 ± 12+13`? You read it as "approximately". It currently prices a preference identically to a firm one, deliberately, until he says otherwise |
| **40** | **Was 15 December 2023 worked as a public holiday?** Declared nationally after the Rugby World Cup win. ⚠️ **The roster itself says yes** — of 144 Fridays, Pattern A appears on eight and seven are confirmed holidays; the eighth is that date |
| **Z** | **Were doctors actually away in December 2024 and 2025?** The year-end shortage appears in December 2023 only. December 2025 had *more* doctors than average |
| **41** | **What would he call "how far this roster is from how you usually do it"?** His own phrase is the one I would rather have. It must not be *churn*, which already means something else |
| — | **Does he roster any *employed* staff** — practice manager, admin, nurses? | 
| **Y / Y2** | **Should requests be due ~15th** so there is build time before the 20th draft? And **how many change requests per doctor per month** during the review window? |

### 🧑‍💼 Yours alone — no need to involve him

| # | What |
|---|---|
| **42** | **Alternative rosters: a few named trade-offs, or N similar solutions?** My recommendation is the first — three or four options each labelled by what it gives up |
| **38** | **Diagnostics retention** — how long before diagnostic records expire? The command journal never does, because it is also the audit trail |

---

## 🌙 For tonight — 1 September 2026

Everything genuinely waiting on a human, ordered by what it unblocks. **Nothing here is blocking
code**; each has a safe default and work continues around it.

### Yours alone, five minutes each

| # | What | Why now |
|---|---|---|
| **32** | ⚠️ **Verify the D01–D16 mapping** in `private/doctor-codes.md`. **More urgent than it was** — D16 was assigned on 1 September for a doctor who left before the original window, and the pairing is my arbitrary choice | 3,145 assignments and every fairness figure are keyed to these codes. Codes are permanent once confirmed |
| **G** | ✅ **Arrived 2026-09-06.** Only follow-up: **is the January 2019 file still the template in use?** | Visual inference is replaced by the real thing. See [*What the Word source settles*](product/export.md#what-the-word-source-settles) |
| **Y** | **Requests due ~15th so there is build time before the 20th draft** — or does the 20th stay the request deadline? | Your dad's own draft-round proposal has no build window in it as stated |
| **Y2** | **How many change requests per doctor per month** during the review window? | Unpriced requests inflate until the system is unusable. A number, even a rough one |
| — | **Should a constraint have a `validFrom` date?** A design call, not a domain fact — see AA below for why it came up | People, weights and memberships already have validity intervals. Constraints do not |

### Your dad — the four that change numbers

| # | What | Why it matters |
|---|---|---|
| **W** | **The agreed weight table has no Friday row.** You confirmed the weekend starts Friday 17:00, but a Friday 17:00–23:00 still prices at 1.0 and a Friday night at 2.5 — same as a Tuesday. Should they price at the Saturday rate? | Moves ~120 shifts between bands, and *raises* the load ratios of the three doctors already showing as most overloaded. Deliberately not guessed |
| **M** | ⚠️ **One label to confirm.** Your fourth answer was written **"H01"**, but H-01 is *exactly one doctor per slot* — structural, and it cannot be "overridden because there are not enough doctors". Read as **H-07**, since it was fourth of four and question 12 gives the same answer independently | One word. It sets a penalty weight |
| **X** | **D07 and D09 alternate the Monday 15:00–23:00 shift fortnightly.** They are the only two exceptions to "GPs cannot work before 17:00" — 13 of 1,086 pool shifts, all Mondays, all alternating. A standing arrangement? | Looks like an undocumented recurring slot, same kind as the Wednesday-night group |
| — | **Sunday holidays.** You confirmed a holiday on a *Saturday* counts once, as a Saturday. Applied to Sunday by symmetry — but that is my inference, not your answer | One word. Affects Easter and December figures |

### Your dad — the three the new data raised

| # | What | Why it matters |
|---|---|---|
| **New** | ⚠️ **Did D03 formally hold both Tuesday 15:00–23:00 and Tuesday 23:00–07:00 through 2024?** Every Tuesday in Jan, May, Jun and Jul 2024 — **34 doubles across eight months**, stopping in August 2024 when D04 took Tuesday night | This is the H-02 counterexample he said existed, and it is a *standing arrangement*, not occasional slips. If confirmed, it means a constraint can be an artefact of headcount — and the catalogue needs re-verifying whenever the workforce changes |
| **Z** | **Were doctors actually away in December 2024 and 2025?** The year-end shortage shows in **December 2023 only** (11 distinct doctors vs a 12.9 mean). December 2025 had **14** — more than average | Decides whether the capacity forecast keys on **December** or on **headcount slack in any month**. Evidence favours the second, which is a different feature. Cannot be settled from rosters — only from the request diaries |
| **AA** | ⚠️ **MEASURED 2026-09-02 — the data answers the *what*, you answer the *why*.** D01 worked **53% of Pattern B Fridays before August 2024 and 9% after**, and the Friday early shift passed to D04. **Was that a decision, or did it just happen?** | Original: *did something change about Fridays in early 2025?* The boundary is a year earlier than that and the mechanism is visible — see [`domain/constraints.md`](domain/constraints.md). What is left is whether you two agreed it, which decides whether the solver should hold it or let it drift |

### Still unanswered from the original list

| # | What |
|---|---|
| **B** | D02 worked a Saturday afternoon on 22 August 2026 — an exception he chose, or a mistake? *(Largely superseded by M's answer that H-05 breaks are mainly requested, but never confirmed for this specific date.)* |
| **Dec 2023** | Four doubles on 9, 12, 19 and 26 December 2023 still want an eyeball. **Much more credible now** — the 2024 data shows the same D03 Tuesday pattern 30 more times — but 9 and 26 December are D01, not D03, and those two are a different shape |

### Two corrections I owe you

**D01 is your dad, not D02.** The repository always had it right; I got it wrong in conversation and
addressed two questions (H-05 and O) to him using D02's figures. Those answers are recorded as
second-hand about a different doctor.

**Two claims of mine were falsified by your own data**, and both are corrected in place rather than
deleted: that he absorbs an exceptional December every year (he does not — December 2025 was 1% *below*
his mean), and that the December shortfall is a practice-wide annual event (it appears in one year of
three). The *decision* you made about absorbed burden stands untouched — that was policy, not an
inference from those numbers.

---

## Open questions — for the practice principal

> ⚠️ **Most of this section was answered on the evening of 31 August 2026.** Thirty-one answers are
> recorded in full under [Resolved](#the-practice-principal-answered-thirty-one-questions--2026-08-31-evening),
> which is authoritative where it disagrees with a row below. Rows are kept with their original
> wording so the reasoning that produced each question survives.
>
> **Still genuinely open:** **W** (Friday burden weight), **X** (the D07/D09 Monday-afternoon slot),
> **Y** (the draft-round schedule), **32** (the code mapping), and confirmation of the "H01" label
> reading in M.

Logged, not blocking. Ordered by how much each changes rather than fills in.

### New, from first reading the source artifacts (2026-08-26)

These came out of the roster images and diary photograph themselves, and several **contradict what
was previously recorded as `[CONFIRMED]`**. Full detail in
[`domain/source-artifact-findings.md`](domain/source-artifact-findings.md).

| # | Question | Why it matters |
|---|---|---|
| **A** | ✅ **ANSWERED 2026-08-31 — both layouts.** Matrix to build in, calendar to export. Original question: does the exported roster have to be a calendar? All 17 of his exports are 7-column Sun–Sat month calendars. The plan specified a doctors × days matrix | **The single most consequential open question.** The export is the artifact of record; if it does not look right he rebuilds it in Word. Working plan is two layouts — matrix to build, calendar to export — but that is more work and he may not want it |
| **B** | **D02 worked a Saturday afternoon on 22 August 2026.** H-05 said "never", `[CONFIRMED]`, zero counterexamples | Was that an exception he chose, or a mistake? Either way H-05 is now **WARN, never BLOCK** — had it shipped as a block, the app would have refused a roster he actually built |
| **C** | ✅ **ANSWERED 2026-08-31 — it is supposed to be D04. The alternation is deviation, not design.** Original: who holds Thursday morning? It alternates between two doctors across every month checked; the brief named one of them as the fixed anchor | Decides whether that is two overlapping recurring slots or a rotation. Different data in the temporal model |
| **D** | ✅ **ANSWERED 2026-08-31 — an arranged swap; swaps happen from time to time.** Original: Monday's anchors have exceptions too — a different doctor on the morning of 13 July 2026, a pool doctor on the night of 6 July 2026. Are those swaps, cover, or just normal? | Confirms S-05 must stay soft. Every "always" checked so far has an exception |
| **E** | ✅ **ANSWERED 2026-08-31 — varied, not abandoned.** Original: on the 10 August 2026 public holiday, two of three Monday anchor slots were kept. The brief said holidays "abandon the weekday anchor pattern" | Too strong as written. Is the pattern varied on holidays rather than abandoned? |
| **F** | ✅ **ANSWERED 2026-08-31 — a slip.** Original: one diary entry lists the same date range with a `±` in both the availability list and the "not working" list.** Correction in place, or a distinction the notation carries? | Affects how the two lists are parsed |
| **G** | ✅ **ANSWERED 2026-08-31 — yes, logo file to follow.** Original question: the practice logo and name appear in the export banner. Confirm we may reproduce them, and get a clean copy of the logo file | Per-tenant export branding is being built now ([ADR-0010](architecture/decisions/0010-productisation-seams-first.md)); the export is the product, so an unbranded one is a worse one |

### From transcribing all fifteen months (2026-08-26)

Run `npm run seed:analyse` to reproduce any of this. It checks every catalogued constraint against
1,430 real assignments.

| # | Question | Why it matters |
|---|---|---|
| **M** | ✅ **ANSWERED PER RULE 2026-08-31: H-04 forced, H-05 mainly requested, H-06 requested, H-07 a real rule overridden when short of doctors.** Original finding: every behavioural rule in the catalogue has counterexamples. H-04 (4), H-05 (4), H-06 (4, one for each supposedly excluded doctor), H-07 (3). ⚠️ **PARTLY ANSWERED 2026-08-31 — see [Resolved](#why-the-constraint-counterexamples-happen--mostly-requested-some-forced-️-partly-2026-08-31).** Most were doctors asking to work more; the December 2025 ones were forced. **Still open: which rule is which.** The fourteen events are listed below as a walk-through — see [M in full](#m-in-full--the-fourteen-events-as-a-walk-through). | **The single most important domain question left.** If deliberate, the app must never block any of them and the warnings should be quiet. If mistakes, the app catching them is a headline feature. Both are plausible and they lead to opposite designs |
| **N** | ✅ **ANSWERED 2026-08-31 — yes, but flexible. A soft per-doctor preference, not a rule.** Original: D03 has worked 3 night shifts out of 201. The roster average is 32%. Is there a standing arrangement that D03 does not work nights? | Striking enough to be a real rule nobody thought to state. **Not modelled** — inferring it from absence is exactly the over-fitting trap |
| **O** | ✅ **ANSWERED 2026-08-31 — forced, through unavailability of other doctors.** ⚠️ Note the framing was mine and it was wrong: these are **D02’s** shifts, not the principal’s. Original: Sunday night then Monday night on 6-7 April 2025, 21-22 September 2025 and 22-23 March 2026 (D02). | Falsifies the brief's reasoning that the Sunday-night exclusions were H-04 working through Monday commitments. Bears on how hard H-04 should be |
| **P** | ⏳ **ANSWERED 2026-08-31 — they exist, along with more older rosters, but are not to hand.** Now a data-delivery item, not a question. Original: May and June 2025 are missing from the images. | Two gaps in the fifteen months, so per-doctor totals are not comparable across the April-to-July 2025 boundary. You mentioned being able to dig up much more history — those two would close the current set |
| **Q** | ✅ **ANSWERED 2026-08-31 — a duplicate in the batch, not a reissue.** Original question: two sheets show the same month on different templates (April 2025, with and without the logo banner), with identical content. Was the roster re-issued, or was one a draft? | Bears on whether the export needs a version/reissue concept, which the publish lifecycle already implies |

#### M in full — the fourteen events, as a walk-through

The abstract question is hard to answer; the concrete one is not. **Fifteen counterexamples fall on
fourteen distinct events** — 3 October 2025 breaks two rules at once. The principal is not
technical, so this table is the readable form of `npm run seed:analyse`, meant to be read down
rather than reproduced.

| # | Date | Who | What happened | Rule broken |
|---|---|---|---|---|
| 1 | Sun 6 – Mon 7 Apr 2025 | D02 | Night, then night again | [H-04](domain/constraints.md#h-04-avoid-back-to-back-night-shifts-confirmed-as-a-rule-he-applies--falsified-as-an-absolute) |
| 2 | Fri 11 Apr 2025 | D04 | Friday 23:00–07:00 | [H-06](domain/constraints.md#h-06-fridays-last-two-shifts-usually-exclude-d01d04-falsified-as-an-absolute) |
| 3 | Fri 15 Aug 2025 | D02 | Friday 17:00–23:00 | H-06 |
| 4 | Sat 16 Aug 2025 | D02 | Saturday afternoon | [H-05](domain/constraints.md#h-05-d02-is-not-assigned-a-saturday-shift-confirmed-as-a-strong-preference--not-absolute) |
| 5 | Sun 21 – Mon 22 Sep 2025 | D02 | Night, then night again | H-04 |
| 6 | Fri 3 Oct 2025 | D01 | Friday 17:00–23:00 — **breaks both** | H-06 **and** [H-07](domain/constraints.md#h-07-d01-rarely-works-a-friday-falsified-as-an-absolute--a-strong-tendency-only) |
| 7 | Sun 22 – Mon 23 Mar 2026 | D02 | Night, then night again | H-04 |
| 8 | Fri 20 Mar 2026 | D01 | Friday midday | H-07 |
| 9 | Fri 3 – Sat 4 Apr 2026 | D13 | Night, then night again | H-04 |
| 10 | Fri 24 Apr 2026 | D01 | Friday early | H-07 |
| 11 | Sat 2 May 2026 | D02 | Saturday afternoon | H-05 |
| 12 | Fri 22 May 2026 | D03 | Friday 17:00–23:00 | H-06 |
| 13 | Sat 27 Jun 2026 | D02 | Saturday **night** | H-05 |
| 14 | Sat 22 Aug 2026 | D02 | Saturday afternoon | H-05 |

**The answer needed is per group, not per row.** For each of H-04, H-05, H-06 and H-07, which of
these is it?

| Answer | What the app does |
|---|---|
| **A — Deliberate.** "I break it when I need to and I do not consider it a breach" | Keep it as a **soft preference with a low penalty**. The solver trades it away freely. No warning banner; a quiet marker at most. It stops being a rule and becomes a scoring nudge |
| **B — Forced.** "I did not want to, but there was nobody else" | Keep it as a **soft constraint with a high penalty**, and the warning **stays after override** — the scar. These are exactly the events pre-flight should predict weeks earlier. This is the current default and the most likely answer |
| **C — Mistake.** "I would have wanted that flagged before it went out" | Keep the high penalty **and** surface it in the pre-publish review as something to fix. Catching these becomes a headline feature, and there is now a fourteen-row regression suite for it |

Answers may differ per rule — B for H-04 and C for H-05 is entirely plausible, and worth more than
one blanket answer. **Nothing about the fourteen rows is being changed until this is answered**; all
four rules are already WARN-only, which is safe under every answer.

Related, and partly answered by the same conversation: **O** (three of the four H-04 events are the
Sunday-night-then-Monday-night pair), **K** (H-07 rule or habit) and **N** (D03 and nights).

### From building the analytics engine (2026-08-31)

Run `npm run seed:report` to reproduce any of this. Design in
[ADR-0012](architecture/decisions/0012-fairness-normalised-by-opportunity.md).

| # | Question | Why it matters |
|---|---|---|
| **R** | ✅ **ANSWERED 2026-08-31 — the three words are confirmed.** Still worth asking the principal. Original question: is there already a word for "the doctor asked to work this shift" as against "I assigned it"?** Three terms — `directed`, `requested`, `absorbed` — were coined on 31 August 2026 to express the distinction described in the answer to M, because none existed. If the practice already has words, theirs win | The distinction is now load-bearing: `requested` burden is excluded from the fairness objective, so the term appears in the UI, the audit trail and the schema. Renaming it later is a migration. **`[PROPOSED]` until confirmed** |
| **S** | **Is a Sunday night harder than a Sunday morning, and by how much?** The burden table prices them identically, which is almost certainly wrong. Same for a public-holiday night | Every burden and load-ratio figure inherits this. It is a two-line data change once answered, and inventing a number would be inventing domain fact. The whole table is `[ASSUMED]` and needs agreeing with the group in any case |
| **T** | ✅ **ANSWERED 2026-08-31 — an unwritten arrangement between them, not an enforced rule. Not modelled as a constraint.** Original finding: D01 appears to be the Saturday doctor and D02 the Sunday doctor. Across fifteen months: **D01 worked 30 Saturdays and 6 Sundays; D02 worked 4 Saturdays and 26 Sundays.** D01 has zero Sundays in nine of fifteen months; D02 has zero Saturdays in eleven of fifteen. D03 and D04 are balanced (25/13 and 24/14). Is that a deliberate split of the weekend between the two of you? | **A stronger pattern than most of the catalogue, and nobody has written it down.** H-05 records only half of it ("D02 never works a Saturday") and treats it as one doctor's preference. If it is really *one* rule — the two senior doctors splitting the weekend — that is a different and much better model than two independent "never" rules. **Not modelled**: guessing here is exactly how H-07 got written wrong twice |
| **V** | ⚠️ **Friday is confirmed weekend work, but the burden table prices it as an ordinary weekday** — a Friday night at 2.5, a Friday evening at 1.0, the same as a Tuesday. And two boundaries are live: does the weekend start Friday **00:00** or Friday **17:00**, where Pattern B’s pool-only back half begins? | About 120 shifts across fifteen months move between two burden bands depending on the answer — enough to reorder the fairness table. It also matters *who*: **D02 worked 45 Fridays, D03 43, D04 33, and D01 only 4**, so under-pricing Friday under-credits exactly the three doctors already showing as most overloaded. Same conversation as **S** |
| **Z** | **Were doctors actually away in December 2024 and 2025?** The year-end shortage shows up in the data for **December 2023 only** — 11 distinct doctors, against a 12.9 monthly mean. December 2025 had **14**, more than average. So either the going-away pattern has changed, or the roster simply absorbed it as headcount grew from 11 to 14. | Rosters record who worked, never who asked to be away, so this cannot be settled from the data — only from the request diaries. It decides whether the capacity forecast should key on **December** or on **headcount slack in any month**. Current evidence favours the second, which is a different feature |
| **AA** | ⚠️ **MEASURED 2026-09-02.** Original: *did something change about Fridays in early 2025?* **Yes, and a year earlier than that.** Quarter by quarter, D01 worked 100% / 58% / 54% of Pattern B Fridays through 2023 Q4 – 2024 Q2, then **8% in 2024 Q3** and never above 20% again — **53% before August 2024, 9% after.** The mechanism is visible: `fri-early` went from D01 (14) / D03 (10) / D02 (8) to D03 (35) / D02 (32) / **D04 (27)** with D01 on 6, and D04's overall load went from 0.09 to 0.47 shifts a day across the same boundary. **The same month and the same cause as the H-02 doubles stopping.** ➡️ **What is still yours: was it agreed, or did it just happen?** | The suspicion in the original row was right and the boundary was wrong. Three consequences. (1) **H-07 stays OFF even if he confirms it** — he would be describing the current era accurately, and if D04 left it would likely reverse. (2) **A solver tuned on all 33 months would reproduce 2024**; it must be tuned on a stated span. (3) It is the strongest argument yet that **constraints need a `validFrom`** like everything else in the temporal model — one workforce event falsified two of them at once |
| **U** | **Does any doctor have a target number of shifts per month, or a contracted commitment?** | Decides whether the `explicit` entitlement basis can ever be used. Without it, fair shares must be inferred from observed availability, which can only understate — so a doctor willing to work more than they were offered looks over-loaded rather than under-used |
| **48** | ✅ **ANSWERED 2026-09-06, and it was neither option.** Asked whether D01's Saturday morning was a standing arrangement or a rotation. The owner corrected the original claim: *"he did misspeak when he said he works every Saturday morning — what he actually meant is that he is **available** every Saturday morning and invariably ends up working **at least 2** Saturday mornings in a typical month."* So it is **a rotation with a floor, and a standing availability underneath it.** Both already hold: D01 carries **no exclusion of any kind** — no `cannotWork` cell, no availability rule, no weekend cap — so he is assignable to every Saturday morning by construction, and S-09's 38% share produces **2 of 4 in September and 2 of 5 in October**. ⚠️ **One known gap:** `0.38 × 5 = 1.9` rounds to a `[2, 2]` range, so the model gives **exactly** 2 every month and never volunteers a third. He worked 3 in two of the last fourteen months, so the floor is right and the ceiling is slightly tight. A third costs 50 and is available when the roster needs it | Confirms the S-09 encoding rather than changing it, and confirms that **the fact was already representable** — the September failure was a missing objective term, not a missing rule. The residual `[2, 2]` tightness is exactly the class of thing [ADR-0016](architecture/decisions/0016-learn-weights-from-edits-not-rules.md) proposes learning from edits rather than asking about |

### From working three months by hand (2026-08-26)

Second, deeper pass over the source. Full reasoning in
[`domain/worked-examples.md`](domain/worked-examples.md).

| # | Question | Why it matters |
|---|---|---|
| **H** | ⚠️ **In December 2025 you worked 14 shifts, including Christmas night and three of the four year-end long days. Do you want the system to spread that, or to leave it alone?** | **The highest-value product question found so far.** A cumulative-fairness objective will read that as an injustice and spend January handing you the easiest shifts — "correcting" a deliberate choice. Three options: mark it voluntarily absorbed and exclude it from equalisation; let the system push back and you overrule it; or something else. **Until this is answered, a cumulative min-max objective including your year-end burden must not ship** — it is the one configuration guaranteed to produce a roster you reject |
| **I** | **The December and January sheets disagree about who worked the night of 1 January 2026.** Did that shift change after December was published? | Concrete evidence for Q26 (how often a published roster changes mid-month). Also sets the seeding rule: I am treating **the sheet whose own month owns the date as authoritative**, so January wins — confirm that is right |
| **J** | **Wednesday 28 January 2026 reads 07:00–15:00, 17:00–23:00, 23:00–07:00 — leaving 15:00–17:00 uncovered.** Typo in the Word table, or was there genuinely a gap? | Almost certainly a typing slip, but it matters twice: it proves the historical data has errors, so seeding must validate arithmetically rather than trust the sheets — and it is a rather good demo of what the app catches in thirty seconds |
| **K** | **H-07 restated: you have never worked a four-shift Friday, but you did work the long day on Friday 2 January 2026.** Is avoiding the four-shift Friday a rule, or just how it works out? | The constraint is now correctly scoped to the *pattern* rather than the weekday, which resolves the counterexample. But rule-or-habit is still open, so the flag stays default OFF |
| **L** | **Thursday morning alternates between two doctors, and Monday morning changed holder twice over the period.** Are those planned rotations, or just whoever was available? | Decides whether these are two overlapping recurring slots, a formal rotation, or no recurring slot at all. Different data in the temporal model |

### Preferences and the request diary

| # | Question | Why it matters |
|---|---|---|
| 4 | **Is `NOT` a hard "cannot work" or a soft "would rather not"?** | Decides whether it maps to `UNAVAILABLE` (hard, consumes budget) or `PREFER_NOT` (soft penalty). Currently ingested as `UNAVAILABLE` with the source token recorded, so reclassifying is a labelled migration. Some ranges are long — `NOT 23-30` — which *reads* like leave, but range length is not sufficient to promote a tag |
| 5 | ✅ **ANSWERED 2026-09-04 — it means "IF NECESSARY".** Not approximately, not alternative dates: the doctor is not offering the date but will take it if the roster cannot be covered otherwise. **Every earlier guess was wrong.** See `domain/preferences.md`. Original: what does `±` mean? Tentative, approximate, or "these dates or alternatively those"? | Modelled as a `TENTATIVE` modifier because *something* conditional is plainly meant. `26-27 ± 12+13` suggests *alternative*, but that is a guess |
| 6 | **What do the tick marks by each name mean**, and why do some have two and some three? | Possibly submission chasing, possibly requests granted. Not modelled |
| 7 | **Is the first list weekend availability?** | `[INFERRED — high confidence]`: the ranges are exactly September's Friday–Sunday triples. Bears directly on Q8 |
| 8 | ✅ **ANSWERED 2026-08-31 — Friday is in it.** The boundary within Friday is now question **V**. Original: is a "weekend" Friday 17:00 → Monday 07:00, or Saturday–Sunday? | **Fairness counting depends on it.** `Weekend` is deliberately not a type until this is answered — code counts concrete Saturday/Sunday/Friday-evening shifts instead |
| 9 | Do doctors state **weekday** preferences at all, or are weekdays purely the anchor pattern? | |
| 10 | How do requests reach you — all WhatsApp, or some in person? Do you chase non-submitters? | |
| 11 | What happens when someone submits nothing? | |

### Rules

| # | Question | Why it matters |
|---|---|---|
| 12 | **Is "D01 never works a Friday" a rule or just how it worked out?** | Sixteen months, zero exceptions. **H-07** ships behind a flag, default OFF: if it is a habit and we encode it as a rule we silently remove your own flexibility, invisibly. If it is a rule and we omit it, you see it in the draft and tell us — cheap and visible. That asymmetry set the default |
| 13 | ✅ **ANSWERED 2026-08-31 — should be absolute, but it has happened, so the app must allow it. H-02 is now WARN, not HARD.** Original: is "at most one shift per day" absolute? | **H-02** is modelled as hard on your "vast majority of the time" plus zero counterexamples. The Pattern C long-day dates are where to check |
| 14 | When you use the 07:00–17:00 long day, **how do you decide who gets it** — volunteered or assigned? | Decides whether the solver distributes it as high burden or restricts it to willing people |
| 15 | Are there **other custom shift patterns** not present in the sixteen months I have? | |
| 16 | Are there **pairs of doctors who should or shouldn't work adjacent shifts** — handover, mentoring, personality? | Not currently modelled at all |
| 17 | ✅ **ANSWERED 2026-08-31 — no fixed target. Anchors 14–15 shifts/month, pool 3–6.** Original: do any doctors have a target number of shifts per month (an FTE equivalent), or is it purely request-driven? | The fairness ledger divides by FTE. Without it, comparing an anchor to a two-shifts-a-month GP is meaningless |
| 18 | ✅ **ANSWERED 2026-08-31 — discussed with the doctors, and it rotates every year. Testable against the 2023 data.** Original: how do you currently decide who works Christmas, New Year and Easter? | The single most valuable answer for S-08 — it tells us what the ledger must reproduce or improve on |

### People

| # | Question | Why it matters |
|---|---|---|
| 19 | ✅ **ANSWERED 2026-08-31 — D15 has left, and the system must handle joiners and leavers without skewing the analytics. Implemented.** Original: is D15 still available? | Last appeared 24 Jan 2026, absent from every roster since and from the September request book. `[INFERRED]` departed — not assumed |
| 20 | ✅ **ANSWERED 2026-08-31 — confirmed.** Original: confirm the anchor/pool reading: D01, D02, D03, D04, D05 as anchors; D10, D12, D13 as occasional GPs | |
| 21 | **When D05 joined, how did you decide which slots he'd take over from D03 and D04?** | Predicts what happens at the next joiner, and joiners are confirmed as normal and ongoing |
| 22 | ✅ **ANSWERED 2026-08-31 — every doctor does, the principal included. Nobody works here full time.** Original: does anyone hold shifts at another practice that constrains availability here? | The data model already supports it; the question is whether it is live |
| 23 | **Do you roster any employed staff** — practice manager, admin, nurses? | Changes the compliance posture entirely. BCEA hard constraints would apply to some people and not others. `StaffCategory` exists for this |

### Process and product

| # | Question | Why it matters |
|---|---|---|
| 24 | **How long does building a month actually take you?** | The baseline metric for whether any of this works |
| 25 | What is the worst part — collecting requests, fitting them together, or handling changes after publishing? | |
| 26 | How often does a published roster change mid-month, and what causes it? | |
| 27 | How do you distribute it now — WhatsApp group, individual messages, printed and pinned? | Decides what the export must match |
| 28 | Who else needs to see it — switchboard, nursing manager, reception? | Scopes the share links |
| 29 | **If the system could only do one thing well, what would it be?** | |
| 30 | ✅ **ANSWERED 2026-08-31 — yes, no problem, scoped to yearly totals.** Original: would you be comfortable with every doctor seeing everyone else's cumulative counts? | Research says published transparency is the mechanism that makes fairness work. But it is your call and **it is not reversible once shown** — so the ledger defaults to admin-only |

---

## Open items — project owner

> **WhatsApp intake is deferred, and that has one consequence worth naming.** On 31 August 2026 the
> owner chose to defer Meta business verification until after a pilot: *"focus on getting everything
> up and running, I will run a month or two while letting my dad use the system we build."*
>
> That is a coherent call and it fits the product's own priorities — the export is the artifact of
> record, and automated intake is not what makes or breaks the pilot. The consequence: **for the
> pilot, requests keep arriving by WhatsApp to the principal exactly as they do now, and he types
> them in.** So v1 needs a *manual preference-entry screen* that is good enough to use monthly under
> time pressure, not a stopgap. It becomes the admin's transcription tool, which is the job the paper
> diary does today.
>
> Verification stays worth starting early whenever he wants it — 2 to 5 business days typically, up
> to 30 — so it is deferred rather than dropped.

| # | Item | Note |
|---|---|---|
| 31 | ✅ **DONE 2026-08-31 — all twelve accepted.** Original: approve ADRs 0001–0012 | All nine are marked `proposed`, not `accepted`. Recording them as accepted before you read them would misrepresent their status. Cheap to change now, expensive later |
| 32 | ⚠️ **STILL OPEN — he approved the *scheme*, not the mapping.** He has not read `private/doctor-codes.md` and said so. The code-to-name pairs are unverified. Original: confirm the D01–D15 code mapping in `private/doctor-codes.md` | Five-second check; everything downstream depends on it. Codes are permanent once confirmed — they appear in the ledger and in historical data |
| 33 | ⏸️ **DEFERRED 2026-08-31 — after a pilot month or two with his dad using the system.** See the note below the table. Original: start Meta WhatsApp business verification | **2–5 business days typical, up to 30 in some cases.** The long pole. Costs nothing to have finished early. Rate confirmed this session: ~R0.12–0.14 per utility message, so ~R20/month at this volume |
| 34 | Repo creation, first commit, Claude GitHub App, `CLAUDE_CODE_OAUTH_TOKEN`, CodeQL, secret scanning, push protection | Track B1/B3. Workflows are authored but not enabled — they need the token to run |
| 35 | ✅ **ANSWERED 2026-09-04 — the burden weights are his own numbers.** Weekday from 15:00 **1.75** (was 1.0), Sunday **3.0** (was 3.5), public holiday **4.0** (was 5.0), Christmas/NY night **6.0** (was 8.0); night 2.5 and long day 1.5 unchanged. `AGREED_BURDEN_V2`, `[CONFIRMED]`. ⚠️ **The unavailability budget is still open** — that half was not asked. | Both currently `[ASSUMED]` placeholders. The weights matter socially as much as numerically: a weight nobody agreed to is a weight nobody accepts when it produces an unwelcome result |
| 37 | ✅ **ANSWERED by research, needs your sign-off only.** Diagnostics for the pilot — [ADR-0013](architecture/decisions/0013-first-party-diagnostics.md) is marked `proposed`. It says: our own Postgres, no third party, **no session replay ever**, and a "Something looks wrong" button producing a file you get by WhatsApp | Nothing is blocked on this — the design is written and locked in. Read the ADR's *Considered alternatives* table if you want the short version of why not Sentry. **Say yes and I mark it accepted** |
| 38 | **How long should diagnostic data be kept?** Currently `[ASSUMED]` **90 days**, then hard-deleted | POPIA s14 says no longer than necessary, so a number has to exist. 90 days is long enough that a fault reported late is still diagnosable, short enough that it is not a liability. **The command journal is separate and is kept with its roster** — that one is the audit trail, and shortening it would weaken the ECTA s15 evidential position. Only the diagnostic exhaust expires |
| 39 | **Is your dad willing to send a diagnostic file over WhatsApp when something looks wrong?** One tap, then share, like sending a photo | This is the single highest-value part of the diagnostics design, because **it is the only part that still works when the app cannot reach the internet** — which is exactly when we most need to know what happened. If he would not do it, the design needs a different escape hatch and I should know that before building it, not after |
| 43 | ⚠️ **PARTLY ANSWERED 2026-09-02, and BUILT to that answer — needs your dad to confirm.** You relayed: *"my dad sees this as a new beginning… only taking the previous 3 months into account might be more in line with what he wants."* **`LEDGER_WINDOW_MONTHS` is now 3**, tagged `[ASSUMED]` because it is your reading of what he wants rather than his answer. ➡️ **Confirm with him: three months, or some other span?** | ✅ **ANSWERED 2026-09-04: three months confirmed, and he does not regard the spread as an imbalance** — *"D01–D04 are all anchor doctors and therefore generally work more during the week."* `LEDGER_WINDOW_MONTHS = 3` promoted `[ASSUMED]` → `[CONFIRMED]`. On his confirmed weights: **D01 +55%, D02 +45%, D03 +21%, D04 +15%**, Gini 0.183. ⚠️ **This row was corrected twice in one day and the first correction was wrong.** It originally said D01 55% / D02 44%; on 3 September I re-ran the report against the then-current `[ASSUMED]` weights, got D02 ahead of D01, and recorded the original as an error. The confirmed weights restore the original ordering. **The lesson is not "trust the doc" — it is that a load ratio is only as meaningful as the weight table beneath it**, and re-deriving one from placeholder weights does not make it authoritative. Gini moved only 0.179 → 0.183 across the reweighting, so the headline was robust throughout; only the ordering within the anchors was ever fragile | Over three months the picture is much smaller and correctable, which is exactly why the window matters. He may also say it is not an imbalance at all — he is the principal, and carrying more may be deliberate. That answer is equally useful |
| 41 | ✅ **ANSWERED 2026-09-04 — he calls them "Variant" months.** In the glossary; use it in the UI. Original: **what should we call "how far this roster sits from how you usually do it"?** The measure is built and calibrated; the **user-facing word is not settled** and is not in the glossary. `lib/analytics/departure.ts` uses *departure* as a working term. It must not be *churn*, which is already defined as something else — how much a **re-solve** rearranges the **previously published** roster | Nothing is blocked: the code works and the term is confined to one module. But a domain word invented in code and then propagated into UI copy is how `Shift`, `Duty` and `Session` became three types for one concept. **One word from either of you settles it** — "departure", "difference from usual", "surprise", or your dad's own phrase, which is the one I would rather have |
| 42 | **Do you want alternative rosters offered as a small set of *named trade-offs*, or as N similar solutions?** My recommendation is the first: three or four options each labelled by what it gives up — *fairest*, *closest to how you usually do it*, *fewest requests broken* — rather than five near-identical rosters with scores | Not blocked, and not buildable well until S-01 lands (see below): today every option would differ only in ways nothing is scoring. Worth your view before it is designed, because the shape decides the editor's whole layout |
| 40 | **Was 15 December 2023 worked as a public holiday?** Declared one nationally after the Rugby World Cup win, and `docs/domain/holidays.md` records the declaration — but the transcribed December 2023 sheet does not flag it, and that sheet is not in `private/source-artifacts/` to check. ⚠️ **The sheet was examined on 4 September 2026 and the question as posed cannot be answered from it.** I asked whether the 15th was outlined red. **Nothing on that sheet is marked** — Christmas Day and the Day of Goodwill are not distinguished either, so this practice does not mark holidays on the printed roster at all. **The absence of a mark on the 15th is therefore not evidence against it.** Re-ask as: *"do you remember working the 15th of December 2023 as a public holiday?"* The transcription was otherwise verified against the sheet cell by cell and matches exactly, including the wrapped 31 December, the `1 Jan` spill, and the same-doctor double on the 26th. ⚠️ **The roster structure still says yes.** `npm run seed:patterns` found that across **144 Fridays in 33 months, Pattern A appears on exactly eight — and seven of the eight are confirmed public holidays.** The eighth is 15 December 2023. A Friday drops its four-shift split *only* on a holiday, so the shift structure on that date behaves exactly like a holiday's. `[INFERRED]`, not promoted: structure is not a human source | It is a **Friday**, so this is not free — flagging it moves that day from weekday burden to holiday burden for whoever worked it. The three other holidays the new check found were weekend dates where `classifyDay` gives Saturday and Sunday priority anyway, so those were corrected outright. This one stays the single entry in `ACCEPTED_DIVERGENCES` in `scripts/check-holidays.ts`; the gate is green either way, and the check fails if the exemption ever goes stale |
| 36 | **Drop the `fte` column from `doctors`?** I removed it from the solver contract in 1.1.0 because it cannot be defined here — your dad confirmed **no doctor works full time at this practice, including him**, so there is no baseline to take a fraction of. It still exists in `docs/architecture/data-model.md` and [ADR-0008](architecture/decisions/0008-temporal-validity-intervals.md) | **Not urgent, and not mine to take** — dropping a column from the schema is an architectural change, and it is possible you want it for something non-fairness (billing, a contracted-minimum). It is safe to leave: nothing reads it. It is *not* safe to populate, because it sits one line from the burden ledger and [ADR-0012](architecture/decisions/0012-fairness-normalised-by-opportunity.md) says burden ÷ FTE is the trap, not the fix. **If you have no use for it, say so and it goes before the first migration** — after that it is a migration, not an edit |

---

## Resolved

### Question G — the Word source and the logo arrived ✅ (2026-09-06)

Two files, supplied by the project owner: **the January 2019 call roster as a `.docx`** and the
**practice letterhead as a PDF**. This closes the item that had been described here as the single
biggest risk in the project.

What was produced from them, all under `private/template/` because `publish:check` refuses images and
documents anywhere else:

| File | What it is |
|---|---|
| `call-roster-blank-template.docx` | The January 2019 sheet with every name, time and date removed. **Page setup, both tables, the `TableCalendar` style, the fonts and the embedded logo are untouched** — the styling is the practice's own, not a reconstruction |
| `tec-logo.png` | The full logo lockup, lifted from the letterhead and cleaned, 1075 × 425, transparent |
| `tec-logo-mark.png` | The circular mark alone, 227 × 228, transparent — this is what sits on the accent band |
| `source/` | Both originals, kept for provenance |

**The measurements are written up in [`product/export.md`](product/export.md#what-the-word-source-settles)** — column
widths, Corbel 10 pt, the exact greys and blues, Letter landscape at 0.5″ margins, and the finding
that a week is built as *two* table rows rather than one.

Three things worth flagging rather than burying:

- ⚠️ **The sheet is from January 2019**, four years before the earliest photographed export. Nobody
  has confirmed it is the file today's rosters come from. **Ask.**
- **The logo is a crop of a scanned letterhead**, so it carries scan artifacts at full zoom. It is
  good enough for print at banner size. If the practice still has the designer's original, that is
  worth one WhatsApp message.
- **Row heights were normalised** in the blank template (270 twips for date rows, 1050 for entries).
  The originals are content-driven minimums — one was 48 twips — so copying them verbatim would have
  produced a lopsided empty grid.

### The practice principal answered thirty-one questions ✅ (2026-08-31, evening)

Relayed by the project owner after sitting down with him. Brief answers, recorded with the exact
wording wherever the wording carries weight.

#### ⚠️ First, a correction to my own error

**D01 is the practice principal, not D02.** The repository had this right throughout —
[`workforce.md`](domain/workforce.md), `HANDOFF.md` and the private mapping all name D01 — but I
addressed several questions to the principal using **D02's** figures. Two answers are therefore
about a *different doctor* than the framing implied:

- **H-05** was put as *"you never work a Saturday"*. H-05 is about D02. His answer — *mainly
  requested* — is still authoritative, because he is the scheduler for every doctor, but it is
  **second-hand about D02 rather than first-hand about himself.** Tagged accordingly.
- **O** was put as *"you worked Sunday night then Monday night"*. Also D02. Same treatment.

Everything else was correctly attributed. Question 18's *"in December 2025 you worked 14 shifts"* was
D01 and therefore right.

#### The rule breaks — question M answered per rule

| Rule | Verdict | Consequence |
|---|---|---|
| **H-04** no two nights in a row | **Forced** | High penalty, and it flags a capacity event. Confirmed by his separate answer to **O**: *"forced to work due to unavailability of other doctors"* |
| **H-05** D02 not on a Saturday | **Mainly requested** | Low penalty. Requested burden is excluded from equalisation, so these breaks stop counting against anyone |
| **H-06** Friday's back half excludes D01–D04 | **Requested** | Low penalty — and now largely superseded, because the GP availability fact explains the pattern without a rule |
| **H-07** D01 not on a Friday | **A real rule, overridden when short of doctors** | High penalty, still WARN. His words: *"correct, however he sometimes overrides it because there are not enough doctors"*, and separately at 12: *"a rule that is broken occasionally… but for the most part a rule that tries to be kept"* |

⚠️ **One label to double-check.** The fourth answer was written **"H01"**, but H-01 is *exactly one
doctor per shift slot* — a structural rule that held across all 1,430 assignments and cannot be
"overridden because there are not enough doctors" without leaving the building unstaffed. Read as
**H-07** because it was the fourth of four asked in that order and because question 12 gives the
identical answer about H-07 independently. **Worth one word of confirmation.**

#### Answers that changed the model

| # | Answer | What changed |
|---|---|---|
| **S+V+35** | *"Weekend starts at Friday 17:00 and all the weights are fair"* | Weekend is now a **defined concept** — `isWeekendShift`, Friday 17:00 → Monday 07:00. Burden schedule promoted from `illustrative-v1` `[ASSUMED]` to **`agreed-v1` `[CONFIRMED]`**. **Question S is closed**: a Sunday night and Sunday morning really are worth the same. ⚠️ **New question W** — the approved table has no Friday row, so Friday still prices as a weekday |
| **Holiday on a Saturday** | *"It counts once as a Saturday, not a Saturday and a holiday"* | **Reversed the day-class ordering.** Saturday and Sunday now outrank `public-holiday`, dropping those dates from 5.0 to 3.0. Sunday is `[INFERRED]` by symmetry — he was asked about Saturday only |
| **13** | *"It should be absolute but it has happened, so the app should still allow for it"* | **H-02 moves from HARD to WARN.** It held across all 1,430 assignments, so the counterexample is presumably in the older data. Consistent with the standing principle that only *overlapping* shifts are refused |
| **Pattern C trigger** | *"GPs can't work before 17:00 since they are working at other practices"* | **The most explanatory fact in the project.** Verified at 97.4% and written up in [`domain/workforce.md`](domain/workforce.md). Explains H-06, Pattern C, the Friday–Sunday diary triples and the Friday 17:00 boundary all at once |
| **17** | No fixed target. **Anchors 14–15 shifts/month, pool 3–6** | Real capacity figures, and they match the data closely (D01 15.3/month, D07 5.2, D12 3.2). Usable for pre-flight forecasting — **not** as an entitlement, since he said there is no set amount |
| **6** | Tick marks = **how many shifts that doctor worked that month** | Not chasing, not requests granted. Gives an **independent cross-check on transcription accuracy** |
| **9** | Weekdays are the standing pattern **except the five who work Wednesday nights: D06, D07, D09, D10, D11** | A recurring slot group nobody had documented. Consistent with the GP fact — a Wednesday night starts at 23:00 |
| **C** | *"It is supposed to be D04 that works Thursday mornings"* | The alternation is deviation, not design. D04 is the Thursday-morning holder |

#### Confirmations

| # | Answer |
|---|---|
| **30** | Yes — everyone may see the running total of **yearly** shifts. The ledger can be published, scoped to the year |
| **18** | He discusses it with the doctors and **it rotates every year** — so the December burden falling on him is not the designed process. **Testable against the 2023 data** |
| **N** | Yes, D03 does not work nights — **but flexible.** A soft per-doctor preference, not a rule |
| **D** | An arranged swap. Swaps happen from time to time |
| **E** | Holidays **vary** the anchor pattern rather than abandoning it |
| **14** | The long day is normally an anchor, and usually volunteered |
| **15** | **No other shift patterns have ever been used.** The catalogue is complete |
| **4** | `NOT` is **hard** — normally leave or something important |
| **5** | `±` means approximately; unusual, and an exception in that entry. Treat as approximately in future |
| **7** | Yes, the first diary list is weekend availability |
| **F** | A slip |
| **90-day departure gap** | *"90 days is a good way to check… that is the number he has in his head as well."* My guess independently matched his |
| **D14** | Definitely arranged — that doctor only ever wanted **Saturday night** shifts |
| **21** | Arranged with the doctors, to delegate some of D03's and D04's shifts to D05 |
| **23** | **Everyone is a contractor.** BCEA rest provisions do not bind. Confirmed |
| **16** | **No pairs** need special treatment. Do not model it |
| **10 + 11** | Always WhatsApp. Silence means no response, and he chases people before building |
| **26** | Mid-month changes are rare — usually sickness or leave |
| **27 + 28** | WhatsApp is the distribution medium, and the roster is **absolutely private, for the doctors' eyes only.** No switchboard, no nursing manager |
| **24 + 25** | The worst part is **collecting requests and fitting them together**; roughly **6 hours a month** once requests are in |
| **T** | Confirmed — an unwritten arrangement between D01 and the other doctor to split the weekends |
| **Sunday-night five** | Both: partly shift-timing, and *"some doctors also have preferences not to work on a Sunday night"* |
| **8-hour turnaround** | Acceptable, and happens from time to time. Confirmed for the third time |
| **J** | A typing slip in the Word table |

#### 29 — the one thing, and it reorders the priorities

> *"That everyone gets accommodated as close as possible to their requests."*

**Not fairness, and not speed.** The pitch has been leading with the cross-month fairness ledger; the
principal's own answer is **preference satisfaction**.

These are not in conflict, but the ordering matters and it was the other way round. Preference
satisfaction is the headline the product is judged on; the fairness ledger is what stops
accommodation being captured by whoever asks loudest. Reflected in the solver's phase ordering, where
preferences already sit above fairness — that now has a stated reason rather than being incidental.

#### Two answers that are design work rather than facts

**The sick-call-at-3am answer is a considered "don't build it".** *"Handle these situations as they
come… each time it happens it's different and so is the solution, so building in contingencies for
this might be futile."* Agreed on automating the *decision*. One distinction worth keeping: the app
should still make **recording** the change trivial, because the 1 January cross-sheet disagreement is
exactly such a change and it left two sheets contradicting each other. No workflow; just a cheap
amendment path.

**The draft-then-final lifecycle is his own proposal** and it is a good one. Written up separately in
[`product/lifecycle.md`](product/lifecycle.md) with the failure modes it needs designing against.

#### Still open after all that

| # | Question |
|---|---|
| **W** | The agreed weight table has no Friday row. Should a Friday 17:00–23:00 or 23:00–07:00 shift price at the Saturday rate rather than the weekday rate? |
| **X** | D07 and D09 alternate the Monday 15:00–23:00 shift fortnightly — the only two exceptions to the GP availability fact. Is that a standing arrangement? |
| **32** | The D01–D15 code mapping is still unverified. He approved the *scheme*, not the pairs |
| **G** | ✅ Received 2026-09-06 — see *Resolved*. Only the "is this still the template in use?" follow-up remains |
| **P** | May and June 2025 plus fifteen months from 2023 — found, not yet on disk |
| Sunday holiday | Confirmed for Saturday, `[INFERRED]` for Sunday |
| **M** label | The "H01" reading. One word |

### Twelve answers from the project owner ✅ (2026-08-31)

Answered while at work, ahead of sitting down with the practice principal. Each is recorded with the
exact wording where the wording matters.

| # | Answer | What changed |
|---|---|---|
| **A** | **Both layouts.** Matrix to build in, calendar to export | The export design is unblocked — the highest-value question on the list. Two layouts, one data model |
| **R** | **`directed` / `requested` / `absorbed` confirmed** | Promoted from `[PROPOSED]` to `[CONFIRMED]` in the glossary and in `lib/analytics/types.ts`. Still worth checking whether the principal has his own words |
| **G** | **Yes to the logo**, clean file to follow | Export branding confirmed. Nothing committed names the practice regardless |
| **Q** | **Not a reissue — a duplicate month in the batch he sent.** Treat both sheets as the same | ⚠️ **Retracts a piece of evidence.** The April 2025 pair is no longer evidence that published rosters get re-issued. The version/reissue concept now rests only on the 1 January disagreement (question I) |
| **8** | **Friday is part of the weekend** — *"this is also why the Friday shifts are a bit different from the rest of the weekdays"* | The calendar-only reading is dead, and Pattern B is explained rather than merely observed. **The boundary within Friday is still open — now question V**, and it exposed a real gap: Friday is priced as a weekday |
| **19** | **D15 has left.** And a requirement: *"new doctors are constantly joining and others are leaving on a year to year basis, so the system we build should be able to elegantly handle this sort of thing without having doctors that have left skew the analytics or fairness scale"* | **This was not met, and is now.** See the entry below |
| **20** | **Anchor/pool reading confirmed** | D01–D05 anchors, D10/D12/D13 occasional. Promoted to `[CONFIRMED]` |
| **22** | Confirmed, **and stronger than recorded**: *"there are no doctors on this roster, including the principal, that works full time at this practice"* | Removes any full-time baseline from which an FTE could be derived. Written up in [`domain/workforce.md`](domain/workforce.md) |
| **31** | **ADRs 0001–0012 accepted** | All twelve moved from `proposed` to `accepted`, dated. A new ADR still starts `proposed` |
| **T** | *"I think they have an unwritten rule between the two of them but it's not a formal rule that gets enforced"* | Confirms the weekend split is **real but informal**. So: not a constraint, and not modelled as one. See the entry below |
| **P** | **The May and June 2025 sheets do exist**, along with more older rosters, but not to hand | Stays open as a data-delivery item rather than a question |
| **5** | *"I think it means plus minus (approximately)"* — to confirm with his dad | `TENTATIVE` modifier keeps its current meaning. Tag stays `[INFERRED]`; the owner's reading is not the principal's |

#### Joiners and leavers were skewing the figures — fixed the same day

The requirement in **19** was **not** being met, and the gap was found by running the report rather
than by reasoning about it. Two distinct failures:

1. **Departed doctors sat in the current fairness average.** D14 and D15 were excluded only by luck —
   they trip the 20-shift bar, but both clear the 60-day window comfortably (421 and 282 active days).
   A departed doctor with 25 shifts would have been included, and would have stayed in the average
   for good.
2. **A recent joiner was being judged.** D05 joined ten weeks before the period ended, cleared *both*
   absolute thresholds (29 shifts, 71 days), and was reported as carrying **30% more than his share**
   on ten weeks of evidence.

Fixed with two additions, both in [`../lib/analytics/metrics.ts`](../lib/analytics/metrics.ts) and
covered by [`membership.test.ts`](../lib/analytics/membership.test.ts):

- **`membership`** — `active` or `inferred-departed`, from a 90-day trailing gap. `[INFERRED]`
  because a roster records who worked, never who left. It independently reproduces the two known
  departures, which is the only validation available.
- **`presenceShare`** — the fraction of the reporting period a doctor was active for. Under 50% is
  low-sample regardless of shift count, which is what catches D05.

**Neither group is hidden.** Both keep their own rows, correctly scoped to the time they were here —
the ledger has to be able to answer *"what did they carry while they were here"*. What they are
excluded from is the practice-wide headline, which is a claim about the doctors being rostered **now**.

Headline Gini on load ratio moved 0.182 → 0.186. The number barely shifted; what changed is that it
now describes twelve well-sampled active doctors instead of thirteen including a ten-week joiner.

#### The weekend split is real but informal — so it is not a constraint

**T** is answered, and the answer is the useful kind: *"an unwritten rule between the two of them,
but not a formal rule that gets enforced."*

That rules out the tempting move. It is **not** added to the constraint catalogue, and no solver rule
is written for it. Recorded instead as an observed tendency in
[`domain/constraints.md`](domain/constraints.md) alongside H-05, which turns out to record only half
of it.

The Friday column added on the same day quantifies the neighbouring rule too: **D01 worked 4 Fridays
in 230 shifts (1.7%)**, against D02's 45 in 252 (18%), D03's 43 and D04's 33. H-07 is a far stronger
tendency than three counterexamples suggested — still not absolute, and still WARN.

### Why the constraint counterexamples happen — mostly requested, some forced ⚠️ *partly* (2026-08-31)

**Answered by the project owner**, relaying how the practice principal thinks about it, and
explicitly flagged as second-hand:

> *"Most of the breaks were deliberate, as in the doctor explicitly asked to work more on that
> occasion for whatever reason, but some of them, especially the December 2025 instances, were forced
> because there was no one else to work at that time. […] There will be occasions and there will be
> doctors that ask for more work because they need the money or some other reason, so this is a
> legitimate reason for breaking, but there are also occasionally instances where there are no other
> doctors and so the load on the few doctors that are present increases."*

**Tagged `[CONFIRMED by the project owner — pending the principal]`.** Not promoted to `[CONFIRMED]`:
the owner said *"if not then wait until I can discuss this more with my dad"*, which is a statement
about confidence, not a formality.

#### What this settles

**H-04 through H-07 stay WARN and must never become BLOCK.** Both halves of the answer point the same
way: a requested break is not a violation at all, and a forced one is a capacity problem the roster
cannot refuse its way out of.

#### What it changed in the design, which was more than expected

The answer is not "A" or "B" from the three options offered. It is that **the same break means
different things depending on who initiated it**, and neither the roster sheet nor the assignment
records which. That is a missing input, not a mis-set penalty — so `provenance` was added to every
assignment, and the fairness arithmetic now treats the three cases differently:

| | Ledger treatment |
|---|---|
| `requested` — the doctor asked | Reported, **excluded from equalisation.** Otherwise a doctor who asks for extra work gets less work next month as a direct consequence: the system punishing someone for volunteering, invisibly |
| `absorbed` — nobody else available | **Counts in full, and flags a capacity event.** Consistent with the earlier decision on the year-end burden: let it look bad, visibly |
| `directed` — the scheduler assigned it | Counts in full. The ordinary case |

Full reasoning in
[`domain/fairness.md`](domain/fairness.md#provenance--why-a-shift-happened-and-why-it-changes-the-arithmetic)
and [ADR-0012](architecture/decisions/0012-fairness-normalised-by-opportunity.md).

**A corollary worth stating: none of the 1,430 historical assignments can be classified.** Provenance
was never recorded, so all fifteen months are `unknown` and every report says so on its face. The
provenance split is inert until the product starts capturing it — which makes capturing it a v1
requirement rather than a refinement.

#### What is still open

- **The per-rule split.** Which of H-04, H-05, H-06 and H-07 is mostly requested and which mostly
  forced? Different penalty weights follow. The fourteen-row walk-through above is the form to take
  to the principal.
- **Are there rules he applies that never appear on a roster?** The owner said he would ask.
- Question **T** is a direct product of this work and is arguably now more valuable than the
  remainder of M.

### The practice is not named in anything committed ✅ (2026-08-26)

**Decided by the project owner:** sanitise before the first push.

No real doctor name appeared outside `private/` at any point, enforced by `npm run names:check`. But
committed files also named **the hospital** and described the principal's family relationship to the
owner. Neither is a doctor's name, so both were inside the stated data boundary — yet together, on a
public repository tied to a named personal account, they arguably identified him by inference.

Both are now removed from everything committed. The practice is described as *"a private
emergency-medicine practice at a hospital in Limpopo, South Africa"*, and the relationship is not
mentioned.

**The reasoning is worth keeping, because the asymmetry decides these cases generally:** naming the
practice later is easy if he agrees, and a named reference customer is genuinely valuable
commercially. Un-publishing is not possible — forks, caches and mirrors persist. So the reversible
option goes in first.

**Still open, and separate:** whether the practice *may* be named once he is asked, and whether the
other twelve doctors know their data is being used. That is Q25 below and it remains a Track C
question. This decision does not answer it; it just means we are not betting the answer.

### Postgres host — Supabase for the pilot, portability kept ✅ (2026-08-26)

**Decided by the project owner:** start on Supabase in its nearest region.

The finding that prompted it: **Supabase offers no South African region** (the community request,
[discussion #34614](https://github.com/orgs/supabase/discussions/34614) from April 2025, is
*unanswered* by staff — not rejected, not committed), and **Neon offers none either**. AWS
`af-south-1`, Azure South Africa North and Google Cloud `africa-south1` all exist.

POPIA s72 makes offshore hosting **legally defensible** with a properly drafted agreement —
s72(1)(a) is disjunctive, so no SCC regime applies. South African enterprise procurement treats
residency as a de facto requirement, but the pilot has one practice and no procurement in the loop,
and the binding risk right now is *never shipping*, not residency.

**The condition that makes this safe, and it is a real engineering constraint, not a caveat:** keep
the schema portable. Plain Postgres, nothing Supabase-specific beyond RLS and auth hooks. Then
moving to a South African region is a known, costed migration triggered by the first real
procurement conversation — not a rewrite.

**This supersedes B7 as originally written.** Full trade-off in
[`ops/environments.md`](ops/environments.md).

### `NOT` means "not working" — the diary's second list decoded ✅ (2026-08-26)

**Answered by the practice principal, relayed by the project owner:** the three-letter token is
**`NOT`**, and it marks **dates the doctor is not working.**

This was the highest-value open question in the project — it defines the preference data model, and
guessing wrong would have been expensive. Two consequences:

- The handwriting is `NOT` throughout, not `MOT`. There is **one** second-list type, not two.
- **The Afrikaans reading is dead.** `MOT` as *moet* ("must") was the second-most-plausible
  candidate and would have **inverted the meaning of every second-list entry**. Recorded as rejected
  so it is not re-proposed.

Written up in [`domain/preferences.md`](domain/preferences.md). The follow-up — hard versus soft —
is Q4 above and remains open.
