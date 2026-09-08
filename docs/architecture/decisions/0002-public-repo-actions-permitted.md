# ADR 0002: Public repository on the personal account, with GitHub Actions permitted

- **Status:** accepted
- **Accepted:** 2026-08-31 by the project owner
- **Date:** 2026-08-26
- **Deciders:** project owner (pending — Track B4)

> In the context of **a solo developer with no second reviewer**, facing **the choice between a
> private repository and the free tiers that only a public one unlocks**, we decided for **a public
> repository on the personal GitHub account with Actions enabled**, to achieve **automated review,
> CodeQL, secret scanning and push protection at no cost**, accepting **that thirteen real people's
> personal data must be rigorously excluded from it**.

## Context

Two sibling repositories appear to hold opposite policies on CI. One uses GitHub Actions
extensively. The other forbids them outright: *"Do not enable or use billable or quota-consuming
GitHub services, including GitHub-hosted Actions."*

**The difference is an account boundary, not a principle.** The prohibition exists because that
repository lives on a *work* GitHub account with access to billable services, and the rule avoids
spending an employer's quota on a personal project. It says nothing about whether CI is a good idea.

This project is on the **personal** account. The prohibition does not transfer, and carrying it
across would forfeit real value for no reason.

The countervailing force is serious and specific: this repository's domain material identifies
**thirteen real doctors** and shows, day by day, where each of them was for over a year. Under POPIA
that is personal information about identifiable living people who have not consented to publication.
Neither sibling repository contains data about identifiable third parties; this one does.

## Decision

**Public repository on the personal account. GitHub Actions permitted.**

Enable, all free on a public repository:

- **Claude PR review** on every pull request — the highest-value single Action here, because there
  is no other reviewer. Prompt scoped narrowly to documented-constraint violations, glossary
  violations, ADR contradictions and correctness bugs, and told explicitly **not** to report style
  preferences.
- **`ci.yml`** — lint, typecheck, test, build.
- **`claude-ci-watch.yml`** — a daily check of the default branch; nothing if green, diagnose and
  open a fix PR if red, **never auto-merge**.
- **CodeQL** via default setup, **secret scanning** and **push protection**.
- **Dependabot** with `groups`, so non-major updates arrive as one weekly PR.

And, as the precondition rather than an afterthought:

- A gitignored `private/` directory, first line of `.gitignore`.
- Stable codes `D01`…`D13` in everything committed.
- Synthetic names in all fixtures and worked examples.
- `npm run names:check` failing the gate if a real surname appears outside `private/`.

**A composite local gate (`npm run check`) remains required regardless.** CI is a backstop, not a
substitute — and a local gate is what lets an agent verify its own work unattended.

## Considered alternatives

| Option | Why rejected |
|---|---|
| **Private repository** | Forfeits CodeQL, secret scanning and push protection, which are paid on private repos. Those are precisely the controls that matter most for a repository handling third-party personal data — so privacy-by-obscurity would have bought *less* actual privacy protection |
| **Public repo, no Actions** (carrying the sibling's rule across) | The rule is an account-boundary rule for a work account. Applied here it costs the only code review available to a solo developer, for no benefit |
| **Public repo with Actions but no Claude review** | `ci.yml` catches what tests catch. It cannot catch "this contradicts ADR-0004" or "this constraint is not in the catalogue", which is where the real risk lives in a domain-heavy project |
| **Auto-merge green fix PRs from `claude-ci-watch`** | An unattended agent merging to the default branch of a healthcare-adjacent project. The PR is the point; a human merges it |
| **Public repo with real names, relying on consent later** | Publication is effectively irreversible — forks, caches and mirrors persist. Consent has not been obtained, and publishing thirteen doctors' shift histories defaults to *no* |

## Consequences

**Good:**

- Automated PR review, CodeQL, secret scanning and push protection, all free.
- Push protection is **non-bypassable** in a way a local hook is not.
- A public repository that visibly handles third-party personal data correctly — anonymised
  fixtures, a documented boundary, an enforced check — is a *better* demonstration of engineering
  judgement than a private one, and it is the same discipline a hospital security review will ask
  for anyway.

**Bad, or accepted as a cost:**

- **One mistake is permanent.** A pushed name cannot be recalled. This is why the check is
  mechanical rather than a documented rule.
- Every fixture, screenshot and example needs deliberate sanitising, forever.
- Commercial thinking in the open. Judged acceptable; the moat is not the source.

**One non-obvious CI detail, recorded because it is easy to get wrong:** in `claude-ci-watch.yml`, do
**not** pass `github_token: ${{ secrets.GITHUB_TOKEN }}` as an *input* to the action. Pushes made with
the default token do not trigger downstream CI on the resulting PR, which defeats the entire purpose
of the workflow. Use it as an `env` var for read-only `gh` calls and let the action authenticate its
own pushes via the GitHub App.

**Revisit when:** the practice principal declines to have the practice named and prefers the work not
be public at all; or a commercial reason to close the source emerges. Note that going private later
does not unpublish anything already pushed.
