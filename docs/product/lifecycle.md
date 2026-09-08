# Roster lifecycle — draft, review, final

How a month goes from a pile of WhatsApp messages to a printed grid on a wall.

**Proposed by the practice principal on 31 August 2026**, in his own words:

> *"Yes this is a deadline, it does not strictly matter but if there is no deadline in place the
> doctors won't respond in time for my dad to finish building the roster. A draft system might work
> well for this — maybe the first draft for the roster should be published by the twentieth and then
> all the doctors can have a look at the roster and send in any additional requests that they might
> want changed, for the final audited version to be released before the end of the month. Look into
> the best way of doing this without introducing more problems."*

The last sentence is the brief. This document is the answer to it.

---

## The honest risk first

**A draft round can make the job worse, not better.** Today he spends about **six hours a month**
fitting requests together, once. A review round adds a second pass, and if it turns into a second
full negotiation the total goes up rather than down.

Whether it is a net win rests on one hypothesis: **handling a change request against an existing
roster is much cheaper than the original fit**, because the structure is already there and only two
or three cells move. That is plausible and it is not proven. So the design below is shaped entirely
around keeping the second pass small, and the measurement that matters after the first pilot month is
not *"did it work"* but *"did the six hours go down"*.

If the second pass is not cheap, the right answer is to drop the draft round rather than optimise it.

---

## The proposed schedule

Dates are `[PROPOSED]`, derived from his 20th-of-the-month deadline. The intervals matter more than
the exact days.

| Day | Stage | Who acts |
|---|---|---|
| **~15th** | Requests due | Doctors submit availability and preferences |
| 15th–20th | Build | The principal (with the solver, later) |
| **20th** | **DRAFT published** | Automatic on publish |
| 20th–25th | Review window | Doctors raise change requests against specific shifts |
| 25th–28th | Adjust | The principal accepts or declines each request |
| **~28th** | **FINAL published** | Automatic on publish |

**He gave the 20th as the draft date, not the request deadline.** Putting both on the 20th leaves no
build time, so requests move earlier. That is a change to his proposal and it needs confirming —
question **Y**.

---

## Seven failure modes, and the design that avoids each

### 1. The draft reopens everything

The largest risk. If the review window accepts free-form requests, it becomes a second submission
round and the six hours becomes twelve.

**Design:** a review-window submission is a **change request against a named assignment** — *"swap my
14th for the 15th"*, *"I can no longer do the 22nd"* — not a preference. Different object, different
screen, different validation. A doctor cannot submit new general availability after the deadline.

**Plus a budget.** Each doctor gets a small number of change requests per month, in the same way the
unavailability budget already caps preference inflation. Unpriced requests inflate until the system
is unusable — that is a documented failure mode, and it applies here identically.

### 2. Doctors plan their lives around the draft

If a draft reads as final, a change in the review window does real damage — someone has booked a
flight.

**Design:** the draft export is **visually unmistakable**. Not a small label: a diagonal DRAFT
watermark, the review deadline printed in the header, and a different accent colour. The final export
is plain. Somebody glancing at a phone screenshot in a WhatsApp group must be able to tell in one
second which one they are holding.

### 3. The final is a different roster from the draft

The worst outcome: a re-solve that is globally better and unrecognisable. He has already told
thirteen people what they are working.

**Design:** the churn penalty (**S-06**) applies **against the draft**, not against last month's
roster. And the review-window adjustment should not be a full re-solve at all — it is a local repair
around the changed cells, with everything else frozen. The natural control is *"how much may it
rearrange?"* rather than a hidden weight.

### 4. Silence is ambiguous

If a doctor says nothing during the review window, has he accepted or not looked?

**Design:** state it up front, in the draft export itself: **no response means accepted.** This
matches what already happens with requests — his answer to question 11 was that silence means no
response and he chases people. The difference is that a *draft* has a printed deadline doing the
chasing for him.

### 5. A change request breaks coverage

*"I can no longer do the 22nd"* can leave a night uncovered.

**Design:** every change request is **evaluated, never auto-applied**. The principal sees the
consequence before deciding — *"accepting this leaves 23:00–07:00 on the 22nd uncovered; these two
doctors could take it"*. This is the pre-flight arithmetic already planned, pointed at a single cell
instead of a month.

### 6. Two PDFs in a WhatsApp group

WhatsApp is the distribution channel and it has no notion of superseding. Two files in a chat is how
the wrong one gets printed.

**Design:** every export carries **version and publication date** prominently, and the final says
FINAL. Beyond that this is a real limitation of the channel, not something the app can fix — worth
saying rather than pretending otherwise.

### 7. The review window becomes a negotiation

Thirteen people discussing a roster in a group chat is not a review; it is a committee.

**Design:** change requests go **to the principal, not to the group.** He remains the sole scheduler
— that is confirmed, and the self-scheduling literature is unambiguous that letting staff negotiate
assignments directly ends badly. The review window collects requests; it does not grant them.

---

## How this maps onto what already exists

Almost all of it is already in the architecture, which is a good sign for the proposal.

| Already decided | Role here |
|---|---|
| Published rosters are **immutable snapshots**; editing creates version N+1 | The draft is version 1, the final is version 2. No new concept needed |
| **Publish → review → lock** lifecycle | Exactly this, run twice a month instead of once |
| **Churn penalty S-06** | Retargeted at the draft |
| **Warn and scar, never block** | A change request that causes a violation is shown and overridable |
| Hash-chained version history | Answers *"what changed between draft and final, and who asked for it"* — which is also the answer to the mid-month-change problem |

**One thing it adds:** a `ChangeRequest` object, distinct from a `Preference`. Those must not be the
same type and there is no state transition between them — the same rule that already separates
`preference` from `assignment`.

---

## What this also solves

His answer to **26** was that mid-month changes are rare and usually sickness or leave, and that the
draft system *"might help solve this issue a bit"*. He is right, partly:

- A review window catches the *foreseeable* changes — planned leave someone forgot to mention —
  before publication rather than after.
- It does nothing for a doctor calling in sick at 3am, and it should not try to. His own answer there
  was that building contingencies for emergencies is futile, and that is correct about the *decision*.
  What the app should still do is make **recording** an emergency change trivial, so the roster of
  record stays true. The December-to-January disagreement over the night of 1 January is exactly such
  a change, and it left two sheets contradicting each other.

---

## Open

| # | Question |
|---|---|
| **Y** | Requests due on the ~15th so there is time to build before the 20th draft — or does the 20th need to stay the request deadline? |
| **Y2** | How many change requests per doctor per month is reasonable? |
| **Y3** | After the pilot: **did the six hours go down?** The only measurement that decides whether the draft round stays |
