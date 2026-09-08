# ADR 0009: PWA-first, with no native wrapper

- **Status:** accepted
- **Accepted:** 2026-08-31 by the project owner
- **Date:** 2026-08-26
- **Deciders:** project owner (pending — Track B4)

> In the context of **thirteen doctors on a mix of iOS and Android and a developer with no Mac**,
> facing **the choice between a web app, a wrapped app and native apps**, we decided for **PWA-first
> with no wrapper**, to achieve **one codebase reaching everyone with no App Store dependency**,
> accepting **that push notification is unreliable on iOS and cannot carry anything time-critical**.

## Context

The requirement, stated by the principal: **web application first, convertible to mobile later.** He
has no Mac, so native iOS is off the table for now; a web app lets iOS users participate without an
App Store presence. Android would be easier if it comes to that.

The user population is thirteen doctors. Not thirteen thousand — thirteen. An App Store review cycle,
a developer-account fee and a release process for thirteen people is disproportionate.

**But the honest constraint is push notification**, and it deserves stating precisely rather than
hand-waved past. iOS Web Push has worked since iOS 16.4 **but only for home-screen-installed apps**,
and Background Sync remains unsupported with no announced timeline. One measurement puts delivery at
**70–85% on iOS against 90–95% on Android**, with subscriptions silently disappearing after one or two
weeks of inactivity.

For a call roster, *"the notification might not arrive"* is clinical-safety-adjacent. That is not
solved by choosing a wrapper — a wrapped app has the same problem for web-push-based delivery, and
solving it properly means native APNs, which means a Mac and an Apple developer account.

*(One correction worth recording: some 2026 write-ups still claim Apple removed PWA support in the EU.
That was reversed in March 2024. The stale claim is wrong.)*

## Decision

**Ship a PWA. No native wrapper.**

And solve the notification problem the right way instead of the platform way:

> **Treat Web Push as a convenience layer and WhatsApp as the guaranteed channel for anything
> time-critical.**

WhatsApp is the channel that actually gets read in South Africa, utility messages cost roughly
R0.12–0.14 each, the whole practice runs under R20/month, and **no incumbent product does it.** This
turns a platform limitation into a differentiator.

**Keep Capacitor as a deliberate, cheap escape hatch — through architectural discipline, not a
dependency.** Build the interactive core (the grid, the preference form, the swap workflow) as
**client components talking to a JSON API**, not Server Components with Server Actions. Use React
Server Components where they are genuinely better: the marketing site, auth, settings and the PDF
endpoints.

This costs almost nothing — the grid must be a client component anyway — and it means the whole
interactive surface could lift into a Vite SPA inside a Capacitor shell **without a rewrite** if a
native app ever becomes necessary.

Also: call `navigator.storage.persist()`, and **never treat IndexedDB as the system of record.** 2026
sources conflict on whether iOS's 7-day script-writable storage eviction applies to
home-screen-installed apps; mitigate regardless rather than resolving the argument.

**Mobile scope is four jobs and no more:** my next shift · my month as a vertical agenda list, never a
grid · who is on now · submit preferences or respond to a swap. **Month construction is explicitly not
built on mobile.**

## Considered alternatives

| Option | Why rejected |
|---|---|
| **Native iOS + Android** | No Mac. Two codebases, two release cycles, two review processes, for thirteen users. Would also make the developer's own iteration loop dramatically slower, and the project already only gets one real trial per month |
| **Capacitor wrapper now** | Adds a build pipeline, store listings and a release process to gain very little: the interactive core is architected so this stays available later at low cost. Deferring is strictly better than committing |
| **React Native / Expo** | Would mean rebuilding the roster grid in a non-DOM layout system. The custom CSS Grid and its exact print control — which *is* the product's core artifact — do not port |
| **Ionic Appflow** for iOS builds from Windows | **Dead.** New sales discontinued; existing customers only through 31 December 2027 |
| **Relying on Web Push for time-critical changes** | 70–85% delivery on iOS with silently expiring subscriptions. Not acceptable when the message is "you are on duty tonight" |
| **Email as the guaranteed channel** | Reliable but not read promptly. WhatsApp is where these thirteen people already coordinate — the current process runs entirely on it |
| **Server Components with Server Actions throughout** | The idiomatic Next.js choice, and it would quietly weld the interactive surface to the server, closing the Capacitor escape hatch for no gain. RSC is still used where it genuinely fits |

## Consequences

**Good:**

- One codebase, instant deploys, no store review, no developer-account fee.
- iOS users participate with no App Store presence at all.
- **WhatsApp as the guaranteed channel is a genuine differentiator**, not a workaround — it is where
  the practice already coordinates, and no competitor offers it.
- The Capacitor path stays open at near-zero carrying cost.
- The highest-leverage mobile feature is the per-doctor calendar subscription, which needs no app at
  all — it puts the roster in the phone the doctor already uses.

**Bad, or accepted as a cost:**

- **Push notification is genuinely unreliable on iOS**, and the UI must be honest about that rather
  than pretending otherwise.
- Home-screen installation requires an explicit user action, and doctors will need walking through it.
- No native calendar or contacts integration. The calendar feed covers the case that matters.
- **Subscribed calendars refresh every 12–24 hours in Google Calendar with no manual refresh option**,
  so a doctor's calendar will be stale. The UI must say so explicitly, and a calendar feed must never
  be relied on to communicate an urgent change.

**Revisit when:** the product is sold beyond the pilot and store presence becomes a credibility
requirement, or a customer requires native push. At that point Capacitor is the first step, and the
architecture is already shaped for it. It is possible to ship iOS from Windows via hosted macOS
runners if it comes to that.
