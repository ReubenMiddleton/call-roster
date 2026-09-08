# Vision

## The problem

A private emergency-medicine practice staffs a hospital emergency centre **24/7/365 with exactly
one doctor on duty at all times**, and has done for roughly a decade. Thirteen doctors. No gaps,
no double cover, no closures — not on Christmas, not on any public holiday. `[CONFIRMED]`

One person builds that schedule. Every month, by hand:

1. Doctors send requests by WhatsApp, ad hoc, through the month.
2. He transcribes them into a page-per-month paper diary.
3. Around the 20th he hand-builds next month's grid in a Word table.
4. He exports it as an image and distributes it.
5. When something changes mid-month, he edits and redistributes.

**Step 3 is a monthly stress event.** The rules are stable in outline, but the assignment is a
constraint-satisfaction problem he solves in his head, under time pressure, while trying to keep
thirteen people happy. He is a clinician, not a scheduler, and he is also on the roster himself.

## The users

| User | Role | What they need |
|---|---|---|
| **The practice principal** | Admin, sole scheduler, and a rostering doctor on the same schedule. **Not technical.** | To build and distribute a month faster, with less anxiety, and without losing any control |
| **The twelve other doctors** | Read the roster; submit requests | To know when they are working, and to believe the process is fair |
| **The hospital** | Switchboard, ward, EC nursing manager | To know who is on duty right now. **A consumer of the roster, never its owner** |

Note that third row carefully. **South African private hospitals cannot employ doctors** — under
the Health Professions Act and HPCSA Ethical Rule 8, private hospitals are conspicuously absent
from the list of bodies permitted to employ practitioners. The buyer is the practice; the hospital
is an audience. That inverts the assumption every US enterprise product in this space is built on.

## What we are building

Minimally stated: **replace steps 1–4.**

- Collect preferences digitally.
- Help him build the roster.
- Produce an artifact **at least as good as the Word table**.
- Remember who has carried what burden over time.

That last one is the point. See [`../domain/fairness.md`](../domain/fairness.md).

## Principles

**1. The export is the product.**
The printable monthly grid is the artifact of record. The failure mode is precise and predictable:
he builds the roster in the app, exports it, **rebuilds it in Word because it does not look right**,
now does double work, and quits. Every hour spent on the export is worth ten spent on the grid
editor.

**2. He must be able to abandon the app mid-month with zero loss.**
Every screen needs an export. If the app is a trap, he will never trust it — and he is right not to.

**3. The solver ships last.**
You cannot model constraints nobody has stated, and a manual tool people actually use beats a
solver nobody trusts. The solver is the last feature in the build order, on purpose.

**4. Warn and scar; never block.**
Constraint violations are visible, explained, and overridable — and the warning **stays** on the
grid after an override rather than disappearing. Only genuinely impossible things are refused. He
has asked for override capability on almost everything, and he is the domain expert.

**5. No LLM generates the roster.**
Measured feasibility on hard nurse-rostering benchmarks is around **2%**, with a documented
tendency to invent people who do not exist. LLMs belong at the edges: turning a WhatsApp message
into a structured preference (with human confirmation, mandatory), and narrating what the solver
decided. Never computing the answer.

**6. Never ask him to enter data twice for the app's benefit.**
During the parallel-running month the double entry is *his* verification ritual, and it should be
framed as his idea, because it is a good one.

**7. The paper diary retires last, not first.**
It is his safety blanket. He should keep it for a month after he stops opening it.

## Non-goals

Explicit, and each for a reason:

| Not building | Why |
|---|---|
| **Any patient data** | Hard product boundary. Keeps the system out of POPIA s26 special-PI entirely |
| **Free-text preference fields** | A free-text box reliably collects religious observance, which *is* special PI. Structured enum only |
| **Payroll, timesheets, clock-in** | These doctors bill fee-for-service. There is no payroll. Time-and-attendance is the wrong data model and probably offensive to the user |
| **Month construction on mobile** | Mobile is a thin consumption app. Every product that tried both is criticised for the mobile side |
| **Doctor self-assignment** | A documented year-long failure in the literature. Doctors state preferences; the principal or solver assigns |
| **A native iOS app** | PWA-first. No Mac available, and a web app lets iOS users participate with no App Store presence. Capacitor kept as an architectural escape hatch, not a dependency |
| **BCEA compliance as a claim** | It would be a false claim for independent contractors, and it invites an argument that the practice has characterised them as employees. Market it as fatigue-risk and fairness management |
| **A spec-driven framework** | Evaluated and rejected. The artifacts are the value; the frameworks are the tax |

## The constraint that shapes the whole plan

> **The roster is built around the 20th of the month. You get one real trial per month.**

There is no way to iterate faster on the thing that actually matters. Plan the entire project
around that beat.

| Month | The principal does | We do | Gate to proceed |
|---|---|---|---|
| M0 | Paper + Word, as always | Digitise history; build grid + export | Export is visually ≥ his Word table |
| M1 | Paper + Word for real, **and** the same data in the app | Watch him; note every hesitation | App output matches his Word output |
| M2 | **App is the source of truth**; diary kept as unused backup | Add the issues panel | He publishes from the app; no Word |
| M3 | App only; doctors start submitting in-app alongside WhatsApp | Preference intake + WhatsApp-paste parsing | ≥ half submit in-app at least once |
| M4+ | App only; generated draft as a starting point | Solver + fairness ledger | He accepts a generated draft with few edits |

## Where this could go

Pilot at this practice, free, as design partner. Then other emergency-medicine practices in the
same hospital group; then other specialties in the same buildings; then the other two hospital
groups, since nothing here is specific to one of them.

The hospital becomes a *buyer* only later, and for a different reason than it first appears: its
willingness to pay comes from **aggregation across practices** — "who is on call across this
hospital" — which is only earned once several practices in one building are already on the
platform. That is the land-and-expand mechanic.

Rough sizing: ~200+ private hospitals across the three South African groups, perhaps 4–8 practice
groups each running a shared roster, so order **1,000–1,500 addressable practices** at 10–20
doctors. Not venture-scale on its own; a good bootstrapped business, and a credible beachhead for
Australia, New Zealand, the UK and the Gulf, where the same
independent-practitioner-with-privileges model exists.

**Three table-stakes features are actually differentiators here**, because the incumbent products
are criticised for exactly them: a genuinely good printable monthly grid; read-only access with no
account required; and speed to a first useful roster.
