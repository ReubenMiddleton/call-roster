---
paths: ["lib/diagnostics/**", "instrumentation.ts", "instrumentation-client.ts", "app/api/diagnostics/**", "lib/**/*sink*.ts", "lib/**/*telemetry*.ts", "lib/**/*logging*.ts"]
---

# Diagnostics conventions

Loaded only when diagnostics code is touched. Design:
[`docs/ops/diagnostics.md`](../../docs/ops/diagnostics.md). Decision and rejected alternatives:
[ADR-0013](../../docs/architecture/decisions/0013-first-party-diagnostics.md).

## The five that will bite

1. **A diagnostic record cannot hold a name.** Identity fields take a `D01`…`D16` reference, never a
   display string. This is a type-level guarantee, not a scrubbing step — "remember to redact" is not
   a control. The running app renders all thirteen real names; the repository's data boundary does
   nothing about telemetry.

2. **No free text in a diagnostic record.** Same hard boundary the product holds for preferences, same
   reason: a free-text field reliably collects what nobody meant to collect. Messages are
   **enumerated codes plus typed parameters**, not sentences.

3. **⚠️ No `console.log` in a production path.** Not style. A host's log drain **is** third-party log
   aggregation — an unregistered sub-processor under POPIA s72 — and unstructured strings are exactly
   how a name gets offshore. Use the sink.

4. **⚠️ No session replay, screen recording or keystroke capture. Ever.** The main screen is a grid of
   thirteen identifiable doctors' movements. Masking is opt-in per element in every vendor and
   defaults do not cover everything. ADR-0013 rejects this permanently, not pending a better tool.

5. **Diagnostics must never cost the user work.** Fire-and-forget writes, retry on failure, drop
   records rather than throw. **No `await` on a diagnostic write inside a user action.** The roster
   always wins — the same principle as *warn and scar, never block*, applied to our own
   instrumentation.

## Naming

- **`appRunId`, never `sessionId`.** [The glossary](../../docs/product/glossary.md) reserves `session`
  as a rejected synonym for `shift`. Giving it a second meaning here reintroduces the ambiguity that
  reservation exists to prevent.
- **`command`** is an intent that may be refused; **`event`** is a fact that happened. Both are
  recorded, they are not the same row, and there is no state transition between them.
- **`diagnostic exhaust`** expires; the **`command journal`** does not, because it is also the audit
  trail. Do not conflate their retention.

## Structure

- All instrumentation goes through the **`DiagnosticSink`** interface — `PostgresSink` in the pilot,
  `NullSink` in tests, `FileSink` locally. **Never import a vendor SDK at a call site.** The whole
  point is that adding an exporter is configuration.
- **OpenTelemetry semantic conventions for field names** — `exception.type`, `exception.message`,
  `exception.stacktrace`. We adopt the vocabulary, not the SDK.
- **Server time, never the client clock**, for anything that is evidence. Keep the client's timestamp
  alongside so skew is measurable.
- A dropped buffer record is **itself recorded**. A silent truncation reads as "nothing happened
  here", which is worse than a visible gap.
- Solve-run diagnostics must pin **CP-SAT version and `num_workers`** — the solver is not
  deterministic across either, so a reproduction missing them is not a reproduction.

## Testing

`NullSink` by default: diagnostics must never make a test slow or flaky. Assert that a failing sink
does **not** propagate into the user action — that is the test most worth having here, and the one
that will actually catch a regression.
