# End-to-end journeys

Playwright specs live here. Deliberately empty for now — the planning phase has no
application surface to drive.

**Scope rule:** three to five journeys that actually matter, not broad coverage. In the
order they become worth writing, following the build order in
[`../docs/README.md`](../docs/README.md):

1. **Build a month** — open the grid, assign every slot, no scroll on a laptop screen.
2. **Export the artifact of record** — A4 landscape print, PDF, and the 2048px-wide image
   sized for WhatsApp's re-encoding. This is the journey that decides adoption.
3. **Publish → review → lock** — publish emits an event, the read-only link works without
   an account, and a locked roster refuses a silent edit.
4. **Submit a preference** — magic link, structured enum only, no free-text field.
5. **Override with a warning** — the violation is overridable, and the warning persists on
   the grid afterwards rather than disappearing.

`npm run test:e2e` is not part of `npm run check`: it needs browsers installed
(`npx playwright install`) and a dev server, so it stays a separate, deliberate run.
