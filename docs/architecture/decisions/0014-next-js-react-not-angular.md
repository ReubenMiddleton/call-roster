# ADR 0014: Next.js and React for the web application, not Angular

- **Status:** accepted
- **Date:** 2026-09-02
- **Deciders:** project owner, 7 September 2026

> In the context of **a call-roster web app that thirteen doctors will open on phones and the
> principal will use on a desktop, maintained by one non-full-time developer**, facing **the choice
> of front-end framework and whether to reconsider the one already in the repository**, we decided
> for **Next.js App Router with React**, to achieve **one codebase that serves the interactive UI,
> the marketing site and the server-rendered PDF export without a second backend**, accepting **that
> React gives less structure out of the box than Angular and that discipline has to come from the
> conventions in `AGENTS.md` instead.**

## Context

**This decision was already made in practice and never recorded**, which is why the ADR exists. The
repository has been Next.js 16 / React 19 since the first commit-less scaffold;
[`../overview.md`](../overview.md) draws it that way, [`AGENTS.md`](../../../AGENTS.md) states it as
architecture, and [ADR-0009](0009-pwa-first-no-native-wrapper.md) rejects "Server Components with
Server Actions throughout" — which presupposes Next.js without ever having chosen it. A framework is
the most expensive thing in the stack to change and it was the one hard-to-reverse choice with no
record. The owner asking *"should this be Angular?"* on 2 September 2026 is a reasonable question
precisely because nothing answered it.

The forces that are real here, rather than generic:

- **Thirteen users, one developer, not full time.** Ceremony costs more than it returns at this size.
- **The export is the product.** [`../../product/export.md`](../../product/export.md) is unambiguous:
  the printable monthly grid is the artifact of record and the most likely way the project fails is
  building the editor before it. That export has to be **server-rendered to PDF**, which means the
  app needs a server tier no matter which framework is chosen.
- **Mobile and desktop from one codebase**, already settled as PWA-first by ADR-0009. The hard part
  there is iOS Web Push reliability, which is a platform problem and identical under every framework.
- **A future Capacitor lift must stay possible.** `AGENTS.md` requires the interactive core to be
  client components against a JSON API for exactly this reason. Capacitor supports Angular and React
  equally, so this constrains the *architecture* and not the framework.
- **~340 TypeScript tests, a twelve-step gate, Biome, and a type-aware ESLint setup** are wired to
  the current toolchain. Switching frameworks means rebuilding the quality gate, not just the UI.

## Decision

**Keep Next.js App Router with React and TypeScript.** No change.

The interactive core stays **client components against a JSON API**; React Server Components are used
for the marketing site, auth, settings and the PDF endpoints, per ADR-0009 and `AGENTS.md`.

The two properties the owner actually asked for are already satisfied and are **not** framework
properties:

| What was asked for | Where it actually comes from |
|---|---|
| Works on mobile and desktop | A responsive PWA — ADR-0009. Any modern framework does this |
| Support for everything we want to do | The server tier for the PDF export, the JSON API seam, and Postgres — none framework-specific |

## Considered alternatives

| Option | Why rejected |
|---|---|
| **Angular** | The owner's own suggestion, and a good framework — but it wins on the axes this project does not have. Its strengths are large teams needing enforced structure, batteries-included forms/i18n/DI, and long-lived enterprise codebases. Here there is one part-time developer and thirteen users. Against that it costs a heavier learning curve (RxJS, DI, change detection) and, more concretely, **a second server tier**: Angular is client-first, so server-rendering the PDF export means adding Angular SSR or a separate Node service. Next gives route handlers in the same codebase. And switching now discards a working scaffold, gate and test suite for no user-visible gain |
| **Remix / React Router 7** | Genuinely close on the merits, and arguably a better fit for a form-heavy admin tool. Rejected because the difference is small and the switching cost is not: it would be change for its own sake |
| **SvelteKit** | Smaller bundles and less ceremony, which suits thirteen users. Rejected on ecosystem depth for the things this project will actually need — PDF generation, table/grid work, auth — and because the maintainer's familiarity is a real constraint when there is one of him |
| **A plain SPA (Vite + React) with a separate API** | Fewer moving parts in the front end, but it *adds* a service to deploy and operate for the export endpoints, against a stated goal of keeping the pilot's operational surface small |
| **Native iOS/Android** | Already rejected by ADR-0009: no Mac, and an App Store release process for thirteen people is disproportionate |

## Consequences

- **Nothing changes today**, which is the point of recording it: the next session does not re-litigate
  the stack, and the reasoning is not reconstructed from memory.
- React's looseness is a real cost, and it is paid in conventions rather than in the framework —
  `AGENTS.md`, `.claude/rules/typescript.md` and the twelve-step gate are doing the job Angular's
  structure would otherwise do. If those conventions erode, this decision gets worse.
- **The PWA is where the mobile-and-desktop requirement is actually met**, so the responsive and
  offline work in ADR-0009 matters more to that goal than anything in this ADR.
- Revisiting is cheap only before the editor UI exists. After that, this is effectively permanent.
