# Compliance

Four findings that **change what gets built**, followed by cheap administrative items worth doing
early. This is not a legal opinion; it is a record of research with sources, and it should be
reviewed by someone qualified before any commercial claim is made.

---

## 1. A work roster is NOT special personal information — protect that

The common error is *"healthcare app in a hospital → health data → special personal information."*
That is a category error. POPIA s26's trigger is health information **about the data subject**, and
here **the data subjects are the doctors, not patients.** The system holds no patient data at all.

Being outside s26 matters a great deal, because s57(1)(d) requires **prior authorisation from the
Information Regulator** — four weeks, extendable to thirteen — before any offshore transfer of
special personal information.

**Three design choices would drag the system into that regime**, and all three are therefore
prohibited:

| Prohibited | Why it would be special PI |
|---|---|
| A leave request with a **reason** field, or a medical-certificate upload | Health information about the doctor |
| **Fatigue or wellness self-reporting**, "unfit to work" flags | Health information |
| **Free-text preference fields** | Reliably collects religious observance — *"no Friday sunset shifts"*, *"off for Eid"*, *"Sabbath"*. A genuine and under-appreciated risk in any preferences engine: a free-text box will eventually collect it |

> **Design rule:** *no patient-identifiable data, no health data, no free-text preference fields* is
> an explicit, **enforced** product boundary — stated in the terms and implemented in input
> validation. Preferences are a structured enum; leave types are administrative categories.

One decision avoids s26, the March 2026 Health Information Regulations, and the s57
prior-authorisation trap simultaneously, and it is worth a great deal in every future security
review. See [`../domain/preferences.md`](../domain/preferences.md).

---

## 2. BCEA rest rules almost certainly do not bind these doctors

Two independent reasons, either sufficient:

1. **They are not employees.** The BCEA applies to employees; independent contractors are outside
   its scope. And South African private hospitals **cannot** employ doctors — under the Health
   Professions Act and HPCSA Ethical Rule 8 plus the 2015 Business Practice Policy, only the Public
   Service, universities, mining companies, NPOs and other registered practitioners may employ
   practitioners.
2. **Even if one were held to be an employee**, the earnings threshold is **R269,600.90 p.a. from
   1 May 2026**, and an emergency-medicine practitioner in private practice earns far above it,
   which disapplies ss9–18 entirely.

This lands on exactly the same answer the practice reached from a completely different direction:
its own accepted minimum turnaround is **8 hours**.

> **Do not enforce rest rules as hard constraints.** Every rule has three modes — **OFF / WARN /
> BLOCK** — configurable per rule, per tenant, per staff category. **Default WARN**, with one-click
> acknowledge-and-override that logs actor, timestamp and reason.

**The override log is the compliance artefact** and the single most defensible feature if anyone
ever litigates fatigue.

### Do not market this as a BCEA compliance product

It would be a false claim for independent contractors, and worse, it invites an argument that the
practice has characterised its doctors as employees — an unhelpful evidential fact if SARS or the
CCMA ever examines the practice's structure.

**Market it as fatigue-risk and fairness management.**

But *keep BCEA enforcement available*, because the practice may also roster genuinely **employed**
staff — practice manager, admin, nurses — who *are* employees and *may* fall below the threshold.
Hence staff category as a first-class entity. Whether such staff exist is `[UNKNOWN]` and logged.

---

## 3. Two evaluator types, or the rule engine gets rewritten

Selling internationally means rule packs, and they are **structurally different**:

- **EWTD** is hard-floor based — 11 consecutive hours' daily rest, never averaged — plus a
  long-window average (48h over 26 weeks for doctors in training).
- **ACGME** is averaging based — 80h/week over 4 weeks, 1 day in 7 free averaged over 4 weeks,
  in-house call no more than every third night averaged over 4 weeks.

A rule engine that only does per-shift checks **cannot express ACGME**. One that only does rolling
averages **cannot express EWTD**.

> **You need a point-in-time constraint evaluator and a windowed-aggregate evaluator**, with
> configurable window length and averaging semantics. Build both, or rewrite later.

Also, under **SiMAP** and **Jaeger**, working time includes time spent **resident on call including
inactive time — a doctor asleep on site.** The data model must distinguish **resident on call**
(counts fully) from **at-home on call** (generally only the worked portion). If "on call" is a
single boolean, the EWTD pack cannot be implemented correctly. See
[`../product/glossary.md`](../product/glossary.md); this is why the bare term is not used anywhere.

**Worth knowing:** an **HPCSA Intern rule pack** is directly saleable to public-sector and academic
hospitals — 40h/week normal plus max 20h commuted overtime = 60h/week cap; max 80h overtime per
4-week cycle; continuous hours reduced from 30 to 26; not every second night; at least one full
weekend off per month. It is also **the only place in South Africa where a hard BLOCK is genuinely
defensible.**

---

## 4. The audit trail is the product's legal spine

Under **ECTA s15(4)**, business records in data-message form are **rebuttable proof of the facts
they contain** in civil, criminal, administrative and disciplinary proceedings; **s15(3)** makes
evidential weight a function of demonstrable integrity.

No law requires a roster to be signed, so s13(1)'s advanced-electronic-signature requirement does
not apply — an **s13(3) click-to-sign** (authenticated user, timestamp, explicit approval) is
legally sufficient.

To actually earn the evidential weight: append-only immutable audit log of every mutation (actor,
timestamp, before/after, reason); **hash-chained published versions**; immutable published
snapshots; MFA on sign-off; preserved override records; **server-side time, never client clocks.**

In a medico-legal enquiry, *"who was the on-duty EC doctor at 02:40 on 14 March"* is a question this
system should answer with an unrebuttable record. That is both a compliance feature and the best
differentiator available against a WhatsApp group.

---

## Data residency

POPIA **s72 is materially more permissive than GDPR**: s72(1)(a) is disjunctive — *"a law, binding
corporate rules **or** binding agreement"* — so a properly drafted contract alone satisfies
adequacy, with no standard-contractual-clauses regime.

But there is **no adequacy list and no safe harbour**, and South African enterprise procurement
treats data residency as a de facto requirement. AWS Cape Town, Azure Johannesburg/Cape Town and
Google Cloud Johannesburg all exist.

> **Confirm the chosen Postgres host offers a South African region before writing a single
> migration.** This is the single highest-priority open technical question — see
> [`environments.md`](environments.md).

### Where the leak actually is

**Not the database — the sub-processors.** Error tracking with names in the payload, SMS gateways,
email providers, log aggregation, support tooling, offshore support access. **Each of those is the
s72 transfer.**

- Maintain a **sub-processor register from day one**.
- **Scrub personal information from logs and error payloads.** Doctor codes, not names, all the way
  through — which the repository's own data boundary already enforces for committed material.
- Share links carry **minimal payload by default**: name and role, never phone numbers.

### ✅ This is now designed, not just noted — [ADR-0013](../architecture/decisions/0013-first-party-diagnostics.md)

The prediction above held up under research on 1 September 2026, so it has a design rather than a
warning attached to it. [`diagnostics.md`](diagnostics.md) has the detail; the compliance-relevant
parts:

- **The pilot's sub-processor register is empty**, and that is the point. Diagnostics go to the
  Postgres instance the roster already lives in, so **no new cross-border transfer, no second s72
  agreement, no second operator.** The database itself is already offshore — Supabase has no South
  African region, see [`environments.md`](environments.md) — which is precisely why adding a
  *second* offshore processor for a two-month pilot is disproportionate rather than merely untidy.
- **Scrubbing is replaced by a type-level guarantee.** A diagnostic record cannot express a name:
  identity fields take `D01`…`D16` references, free text is refused outright, and a gate step fails
  on either. "Remember to scrub" is not a control.
- **⚠️ Session replay is prohibited outright.** The main screen renders thirteen identifiable doctors'
  movements; masking in every vendor is opt-in per element and defaults do not cover everything. One
  unmasked cell is the s72 transfer this whole section is about.
- **`console.log` is prohibited in production paths.** A host's log drain **is** third-party log
  aggregation — an unregistered sub-processor — and unstructured strings are how a name gets there.
- **Doctor codes are pseudonyms, not anonymisation.** The mapping exists, so the records remain
  personal information and retention still applies. The design says this explicitly so nobody later
  argues the logs are exempt.
- **Retention is two clocks**: diagnostic exhaust expires (90 days `[ASSUMED]`, the owner's call);
  the command journal is kept with its roster, because it **is** the ECTA s15(4) audit trail this
  section requires. One mechanism serving both is deliberate.

---

## Cheap administrative items, worth doing early

These gate enterprise vendor onboarding and cost almost nothing.

| Item | Note |
|---|---|
| **Register an Information Officer** with the Regulator | Mandatory. The IO defaults to the CEO and **may only take up duties after registration** |
| **Publish a PAIA manual** | Compulsory for all private bodies — the small-business exemption expired 31 December 2021 |
| **File a B-BBEE affidavit** | An EME under R10m turnover gets Level 4 free by sworn affidavit; ≥51% black ownership converts that to Level 2 at 125% recognition, or Level 1 at 135% if 100%. Note this falls under the **Amended ICT Sector Code**, where the ownership target is **30%**, not the generic 25% |

---

## Third-party personal data in this repository

Sixteen months of roster images, a diary photograph and the original project brief all name thirteen
real doctors and show, day by day, where each of them was for over a year. Under POPIA that is
personal information about identifiable living people who have **not** consented to its publication.

The repository is public. The rule, enforced mechanically:

> **Real doctor names, and the source artifacts containing them, never enter the public
> repository.**

Implementation: a gitignored `private/` directory as the first line of `.gitignore`; stable
anonymous codes `D01`…`D13` in everything committed; synthetic names in all fixtures and worked
examples; and `npm run names:check`
([`../../scripts/check-no-real-names.mjs`](../../scripts/check-no-real-names.mjs)) failing the gate
if a real surname appears outside `private/`.

**Two questions for the practice principal, neither answered:**

1. May the practice be **named publicly** as the design partner? A named reference customer is
   commercially valuable later, and this is a small ask.
2. **Do the other twelve doctors know** their names and shift histories are being used to build
   this?

Naming the practice and publishing thirteen doctors' shift histories are different questions, and
**the second defaults to no.** Both are logged in
[`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md), and the first is time-sensitive because the
first push is irreversible.
