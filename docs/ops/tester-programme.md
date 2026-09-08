# The tester programme, and the environments it needs

Researched 3 September 2026, after the owner described forming a business with two family members —
a cousin as business lead, a brother doing graphic design and UI styling — and asked whether a
dev/prod split plus a structured testing programme for them would be worth building.

**Short answer: build the environment split, build it for a reason you have not yet named, and do
not build the testing product.** Details below, in the order they change the plan.

---

## 1. ⚠️ The binding constraint is POPIA, not infrastructure

**The question "should we have a dev deployment?" is already answered, and not by engineering.**

If the cousin and the brother test the application, they see whatever is in it. If that is the
practice's real roster, then **two people with no role at the practice are looking at thirteen
identifiable doctors' movements, day by day, for three years** — the exact artifact this whole
repository is built to contain. `private/` is the first line of `.gitignore`, `names:check` fails the
gate on a real surname, `publish:check` refuses a roster image; enforcing all of that against a public
repository and then handing the same data to two relatives would be theatre.

Neither of them has a lawful basis to see it. Under POPIA the doctors are the data subjects, they have
not consented, and "he is my brother and he is helping" is not a ground for processing.

> **Rule: the environment the testers use contains synthetic data only.** Invented practice,
> invented doctors, `D01`-style codes with obviously fake names — the same standard already applied
> to fixtures, and for the same reason.

That settles the architecture. **The two environments differ by data, not by code**, which is what
you want anyway: a dev deployment running different code from production is a dev deployment that
tests something you will never ship.

It also means the split is not optional and not a nice-to-have. It is the only lawful way to let them
touch the product at all.

---

## 2. ⚠️ They are not the users, and the arithmetic on that is unkind

Nielsen's finding is the one usually cited for small test groups: **five users surface about 85% of
usability problems, and the first user alone gives about a third.** With three people that looks like
a good deal.

The caveat is the part that matters here. The rule **only holds for a uniform group of people who
would use the product in similar ways.** A business lead and a graphic designer are not rostering
doctors, and they are not the practice principal — a non-technical doctor who builds a month by hand
in a Word table and will judge the product on whether the printout looks right.

So, honestly, split by what each kind of tester can actually find:

| Failure class | Cousin + brother | The practice principal |
|---|---|---|
| Crashes, dead buttons, broken flows | ✅ **Good at this** | Will find them too, and will lose confidence |
| Confusing labels, bad mobile layout | ✅ **Good at this** | Yes, but his time is scarcer |
| A misread constraint | ❌ Cannot see it | ✅ **Only he can** |
| A fairness verdict that is wrong | ❌ Cannot see it | ✅ **Only he can** |
| An export that does not match his Word table | ❌ Cannot see it | ✅ **Only he can** |

[`testing-strategy.md`](testing-strategy.md) opens with the reason this matters:

> **The dominant risk on this project is building the wrong thing correctly.**

Two testers of the wrong type do not reduce that risk at all. They reduce a different, real, smaller
risk — that the thing crashes while he is trying to judge it.

**That is still worth having**, and it is the honest case for the programme: *the cousin and brother
protect the principal's patience, so that the one hour of his attention that matters is not spent on
a stack trace.* Frame it that way and it is clearly worth a weekend of setup. Frame it as
"extensively testing the app" and it will disappoint.

**Do not defer the principal on the strength of it.** One user of the right group beats two of the
wrong one for everything on the bottom three rows.

---

## 3. ⚠️ A disagreement worth stating: the brother is not blocked

The plan is to bring both in after the MVP, on the grounds that *"until then there's nothing much
they can do."* For the cousin that is probably right. **For the brother it is wrong, and it is the
expensive kind of wrong.**

Every durable document in this project says the same thing:

> **The export is the product.** The printable monthly grid is the artifact of record, and the
> predicted failure mode is precise — he builds the roster in the app, exports it, rebuilds it in
> Word because it does not look right, does double work, and quits.

The current top blocker is **question G: the blank Word template and the logo.** A graphic designer
is exactly the person for print layout, a logo, and a greyscale-safe encoding — and
[ADR-0006](../architecture/decisions/0006-custom-css-grid.md) has already specified the hard part of
the brief for him (four non-colour-dependent channels, no colour-by-doctor, must survive photocopying
and WhatsApp's JPEG pipeline).

Being fair to the plan: **the template itself must come from the principal.** It is his existing
document and the brother cannot invent it — so the blocker is not removed by involving him. But the
logo, the print stylesheet and the encoding are on the critical path, they are design work, and
building the export first and restyling it afterwards is the expensive order.

**Suggested:** bring the brother in on the export alone, early and narrowly. Leave the cousin until
there is a product to lead.

---

## 4. Most of this is already designed — it is ADR-0013, and it is unbuilt

The request was *"a way to store test results and logs somewhere for us to analyse and act on."* That
system is designed in [`diagnostics.md`](diagnostics.md) and
[ADR-0013](../architecture/decisions/0013-first-party-diagnostics.md). **The tester programme is not a
reason to design a second one; it is the reason to build the first one earlier.**

Two layers do almost all the work here:

- **L1, the command journal.** Every user intent, append-only, correlated to a roster version, and
  **deterministically replayable**. For a tester programme this is strictly better than logs: you do
  not read about what your brother did, you re-run it.
- **L5, the diagnostic bundle.** A *"Something looks wrong"* button producing one downloadable file
  he sends over WhatsApp. **This is the whole non-technical feedback mechanism.** No account, no bug
  tracker, no training, and it works when the network is dead.

L5 also answers a finding from the UAT literature: untrained testers report issues in imprecise
language and often cannot articulate cause and effect. **So do not depend on them writing a good bug
report.** Capture the context automatically and ask them one question — *what were you trying to
do?* — which is exactly L5's shape.

### ⛔ Session replay is still a hard no

It is the obvious tool for watching non-technical testers, it is cheap, and ADR-0013 rejects it in
writing precisely because it is tempting:

> The app's main screen is a grid of thirteen identifiable doctors' movements. Masking is **opt-in
> per element**; one unmasked cell uploads exactly what the entire repository architecture exists to
> prevent.

Synthetic data in the tester environment weakens that objection *for that environment only* — and the
instrumentation would then be in the codebase, one config flag away from production. Not worth it.
**The command journal gives better diagnosis than a video anyway, because it is replayable rather
than watchable.**

---

## 5. Environments: one repo, two deployments, differing only in configuration

**One repository — yes, unambiguously.** Trunk-based, environment selected by configuration, never by
a long-lived divergent branch. Two repos means cherry-picking between them, which is how dev and prod
silently stop being the same product.

### Concrete shape, with the platform facts checked

| | Production | Tester environment |
|---|---|---|
| Branch | `main` | one long-lived branch, e.g. `staging` |
| Data | the real practice | **synthetic only** |
| Who has access | the principal, the owner | cousin, brother, owner |
| Dev tools | absent from the build | enabled by explicit flag |

- **Vercel** has exactly two default targets: *Production* is the production branch, *Preview* is
  every other branch. A `staging` branch therefore lands in Preview unless you buy Pro — **custom
  environments are a Pro feature.** On Hobby the working pattern is a persistent branch with a
  branch-scoped domain and branch-scoped environment variables, which gives a stable URL to hand the
  testers. Environment-variable changes apply only to *new* deployments; you must redeploy.
- **Supabase's free tier allows two active projects**, so dev and prod can both be free. Free
  projects pause after inactivity — expect to un-pause the tester project before a session.
  **Supabase branching is Pro-only** at $0.01344 per branch-hour, and an always-on branch costs about
  what a dedicated project does without the isolation. Use two projects, not branching.
- Compute is billed per project, so a third environment is a third bill. **Two is the right number**
  — there is no separate staging *and* dev until there is someone to occupy them.

This is additive to the **$30–45/month at 15 users** already estimated in
[`environments.md`](environments.md); during the tester phase it should be roughly zero.

### Dev-only tools: flag them, and enforce it on the server

The instinct — *tools only reachable from the dev deployment* — is right. The mechanism matters:

- **Never gate on `NODE_ENV` or the hostname alone.** That is a security control that fails open when
  a build config is wrong, and it will be wrong eventually.
- Gate on an **explicit environment variable**, and enforce it **server-side on every route that
  does anything**. A hidden button is not access control.
- Tools that only *read* (show the solver's cost breakdown, dump the command journal) can be a flag.
  Tools that *write* — seed the database, reset a month, impersonate a doctor — must be **absent from
  the production build**, not merely hidden in it.
- This is the same seam as the `[ASSUMED]`/`[INFERRED]` constraint flags in `AGENTS.md` and the
  productisation seams in [ADR-0010](../architecture/decisions/0010-productisation-seams-first.md).
  One flag mechanism, not three.

---

## 6. ⛔ What not to build: the testing product

The part of the request to decline is *"a way to do it very extensively"* with stored, analysable
test results.

Building test-run tracking, structured UAT script management and a results dashboard **for two
people** is the same category error ADR-0013 already identified about self-hosting Sentry: real
infrastructure for a problem that does not have the volume to justify it. It also competes for the
only scarce resource on this project, which is the owner's build time — spent on the export, it
retires the largest risk; spent on a testing dashboard, it retires none.

**What is enough, and is genuinely enough:**

1. **A shared document of numbered scenarios**, written as business tasks rather than technical
   steps — *"build next month's roster and print it"*, not *"POST to /api/solve"*. The UAT literature
   is consistent that non-technical testers do well with scripts and badly without them.
2. **The L5 button** for anything that looks wrong, at any point.
3. **One free-form session per tester** after the scripts, because exploratory testing finds the
   better defects and the scripts will not cover what you did not anticipate.
4. **The command journal** as the record. It already exists in the design, it is already the audit
   trail, and it needs no second system.

Revisit when there are more testers than you can name, or a paying customer.

---

## 7. Open, and for the owner

Logged in [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md) rather than decided here:

- **Question 45 — does forming a company change the data relationship?** Today the principal's data
  is processed under an informal family arrangement. A company processing a practice's personal
  information on its behalf is an **operator** under POPIA and needs a written agreement under s21.
  Not urgent, cheap to get right early, expensive to retrofit once there are three shareholders and a
  customer. Same conversation as naming the practice publicly.
- Whether the brother starts on the export now — section 3 argues yes, but it is the owner's call
  about his own family and his own timeline.
