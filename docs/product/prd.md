# Product requirements

Capabilities in **build order**, each with EARS acceptance criteria. The order is deliberate and is
the strongest sequencing recommendation in the research — see
[`vision.md`](vision.md) for why the solver is last.

Acceptance criteria use EARS notation and become test names directly. Nothing here is implemented
yet; this document states target behaviour.

---

> ## ⚠️ C-01 and C-02 need a decision before either is built
>
> On first reading the source artifacts (26 August 2026) it turned out that **all 17 of the
> practice's actual exports are 7-column Sun–Sat month calendars**, not doctors × days matrices —
> five or six week rows, each cell holding three to four `Name  time` lines, with a practice logo and
> name in a banner and public holidays outlined in red.
>
> The matrix layout specified below is well-reasoned **for the editor**. But the artifact of record is
> a calendar, and the project's sharpest warning is that if the export does not look right he rebuilds
> it in Word and quits.
>
> **Working conclusion: two layouts.** A matrix for building (dense, one screen, fast to assign) and
> a calendar for the export (matches what he already distributes). That is more work than one view,
> and it needs his confirmation rather than our assumption — it is possible he would prefer the matrix
> once he sees it, and it is possible the calendar is non-negotiable.
>
> Logged in [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md). Detail in
> [`../domain/source-artifact-findings.md`](../domain/source-artifact-findings.md).

## C-01 The month grid (editor)

Doctors as rows, days as columns, a doctor code in each cell.

The arithmetic is favourable and worth protecting: 31 columns at 40px plus a 160px name column
≈ 1,400px; 15 rows at 36px = 540px. **The entire month fits on one laptop screen with no
scrolling** — the single biggest advantage over both the paper diary and any generic calendar app.
Do not let padding or avatars cost you the no-scroll month.

- `THE system SHALL display one calendar month with doctors as rows and dates as columns.`
- `THE system SHALL render a full month for 15 doctors without horizontal or vertical scrolling at 1366×768.`
- `THE system SHALL keep the doctor-name column and the date header visible while the grid scrolls.`
- `WHEN a date uses a shift pattern other than the weekday default, THE system SHALL indicate that on the date header.`

**Not an event calendar.** A roster is a matrix — rows × days × a code. Every commercial
"scheduler" library models *resources × continuous time* in pixels-per-minute, which is a different
problem. See [ADR-0006](../architecture/decisions/0006-custom-css-grid.md).

## C-02 The export — *the most important capability in the product*

- `THE system SHALL export the month as A4 landscape by default and A3 as an option.`
- `THE system SHALL export a PDF carrying the period, a version number, a generated-at timestamp, and a short link to the live roster.`
- `THE system SHALL export a raster image exactly 2048 pixels wide.`
- `THE system SHALL render every cell legibly in greyscale.`
- `WHILE a roster is in DRAFT, THE system SHALL watermark every export as a draft.`

**Why exactly 2048px:** WhatsApp re-encodes images as JPEG at roughly 60–75% quality, downsampling
to about 2048px wide and targeting 150–200KB, with blocking artifacts worst on text and sharp
edges. Rendering at exactly 2048px gives 64px per column — ample for a bold doctor code — and
avoids being downsampled twice. Also offer the PDF and hint that "Send as Document" avoids
compression entirely.

**Colour: do not colour by doctor.** Thirteen to fifteen categories is far beyond what categorical
palettes support; the colourblind-safe Okabe-Ito palette stops at eight deliberately, and design
systems warn that categorical colour becomes hard to read past six. Instead:

```
Cell background  = shift type (3 colours, distinguishable in greyscale by luminance)
Cell text        = doctor code (2–3 characters, bold)
Cell corner mark = constraint warning (a triangle — shape, not colour)
Cell border      = locked / manually overridden (dashed vs solid)
```

Four independent, non-colour-dependent channels. This is also exactly what the paper diary and the
Word table already do, so it is a paper-parity win as well as an accessibility one.

## C-03 Click-to-assign

- `WHEN the admin selects an empty shift slot, THE system SHALL present the eligible doctors sorted by eligibility.`
- `THE system SHALL make every assignment operation achievable with single-pointer input without dragging.`
- `WHERE drag-and-drop is offered, THE system SHALL provide an equivalent click-based path.`

**Click is primary; drag is an optional accelerator.** This is not a nicety —
[WCAG 2.2 SC 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) (Level AA)
requires all dragging functionality to be achievable by single pointer without dragging unless
dragging is *essential*. Moving a doctor from the 14th to the 15th is a discrete selection between
enumerable options; that is not an "essential" argument you win. Adding keyboard support does
**not** satisfy 2.5.7.

Beyond compliance: drag has a very low discovery rate, the primary user is a non-technical doctor
moving off paper, and cells are about 40px wide. Click → popover of eligible doctors → click a name
is two clicks with no aiming, and it is faster.

## C-04 Warn and scar, plus the issues panel

- `IF an assignment violates a constraint whose mode is WARN, THEN THE system SHALL permit it and display the specific reason inline.`
- `WHEN a violation is overridden, THE system SHALL retain a persistent visible marker on that cell.`
- `THE system SHALL record actor, server timestamp and reason for every override.`
- `IF an assignment would place one doctor on two overlapping shifts, THEN THE system SHALL refuse it.`
- `THE system SHALL provide a collapsible issues panel listing every outstanding violation in the month with a count.`

Overlapping shifts is the *only* hard block. Everything else warns.

The issues panel is what replaces the principal's current mental re-reading of the diary, and it
should be the thing he checks before publishing.

**On infeasibility, present a menu of minimal relaxations, not a diagnosis.** He does not want
"constraints {7, 19, 44} are mutually inconsistent". He wants *"you cannot cover the 16th–18th
unless one of these three people works a night they asked off."*

## C-05 Publish → review → lock

- `WHEN the admin publishes a roster, THE system SHALL create an immutable version snapshot.`
- `WHEN a roster is published, THE system SHALL notify every doctor, activate calendar feeds, mint a read-only link, and snapshot a printable PDF.`
- `WHILE a roster is LOCKED, THE system SHALL reject direct edits and require a swap transaction.`
- `WHEN a published roster changes, THE system SHALL show every viewer what changed since they last looked.`
- `THE system SHALL grant read-only access without requiring an account.`
- `THE system SHALL hash-chain published versions so tampering is detectable.`

**Read-only access with no account is a strategic feature, not a convenience.** The incumbent whose
market position is bought almost entirely with frictionless read access uses a shared institutional
access code with unlimited viewers. Copy that, and add what it lacks: **scoped, expiring, revocable**
share links — one for the hospital switchboard showing only "who's on now + next 7 days", one for the
practice showing the full grid — with **minimal payload by default** (name and role, never phone
numbers) for POPIA reasons.

**"I didn't know the schedule changed" is the number-one complaint driver in this market**, and
nobody does the diff well. An unannounced silent edit to a live call roster is a patient-safety
event.

## C-06 History and the fairness ledger

- `THE system SHALL maintain a per-doctor cumulative burden balance persisted across months.`
- `WHEN a roster is published, THE system SHALL credit each doctor the burden they carried.`
- `THE system SHALL express any doctor's balance in one plain-language sentence.`
- `WHEN burden weights change, THE system SHALL apply them forward only.`
- `WHEN a public holiday is declared, THE system SHALL recalculate the ledger.`

Visibility of the ledger to non-admins is **configurable and defaults to admin-only**, because
publishing thirteen people's counts to each other is the principal's call and is not reversible.

## C-07 Preference collection

- `THE system SHALL accept preferences only as typed values from a fixed enumeration.`
- `IF a preference submission contains free text, THEN THE system SHALL reject it.`
- `THE system SHALL cap UNAVAILABLE declarations per doctor per period.`
- `THE system SHALL record leave as an administrative category and SHALL NOT store a reason.`
- `WHEN the preference window closes, THE system SHALL notify the admin of who did not submit.`

Authentication is magic-link: thirteen doctors, no passwords to reset. TOTP or passkeys for admin.

## C-08 Calendar feeds and notifications

- `THE system SHALL publish a per-doctor calendar subscription feed.`
- `THE system SHALL emit expanded concrete events, not recurrence rules.`
- `WHEN an assignment changes, THE system SHALL keep its identifier stable and increment its sequence number.`
- `THE system SHALL state in the UI that subscribed calendars may be up to 24 hours stale.`
- `THE system SHALL treat push notification as best-effort and SHALL NOT rely on it for time-critical changes.`

**The staleness warning is required, not defensive.** Google Calendar refreshes subscribed feeds
every 12–24 hours with no manual refresh option, so a doctor's calendar *will* be stale. Never rely
on the feed to communicate an urgent change.

Emit concrete events rather than recurrence rules because a published roster's swaps make any
recurrence rule a lie. Calendar feed URLs are bearer credentials — opaque, per-user, revocable.

**Push is a convenience layer; WhatsApp is the guaranteed channel** for anything time-critical. iOS
Web Push works only for home-screen-installed apps, with measured delivery around 70–85% versus
90–95% on Android, and subscriptions silently disappearing after a week or two of inactivity. For a
call roster, "the notification might not arrive" is clinical-safety-adjacent.

## C-09 The solver — *deliberately last*

- `WHEN the admin requests a draft, THE system SHALL enqueue the solve and return immediately.`
- `THE system SHALL always return a solution, reporting violations rather than failing.`
- `IF the time budget expires, THEN THE system SHALL return the best solution found so far with its objective value.`
- `THE system SHALL penalise divergence from the previously published roster.`
- `THE system SHALL provide a per-constraint cost breakdown for any returned solution.`
- `BEFORE invoking the solver, THE system SHALL verify that demand does not exceed available doctor-shifts and SHALL name the specific dates that fail.`

Never a synchronous request. See
[`../architecture/solver-contract.md`](../architecture/solver-contract.md).

---

## Explicitly out of scope

Patient data of any kind · free-text preferences · payroll, timesheets, clock-in · month
construction on mobile · doctor self-assignment · credentialing · a native app wrapper · any claim
of BCEA compliance · handwriting recognition of the paper diary.

Each is reasoned in [`vision.md`](vision.md) or
[`../domain/preferences.md`](../domain/preferences.md).

## Mobile scope

Four jobs, and no more: **my next shift** · **my month as a vertical agenda list, never a grid** ·
**who is on now** · **submit preferences / respond to a swap**.

The highest-leverage feature per line of code on mobile is the per-doctor calendar subscription —
it puts the roster into the phone the doctor already uses, and then the app does not need to be
opened at all.
