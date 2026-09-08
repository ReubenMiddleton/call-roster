import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // Node by default, deliberately. The bulk of this project's tests are pure logic —
    // constraint evaluation, date and shift-pattern arithmetic, fairness ledger
    // accumulation, solver-contract serialisation — and none of that needs a DOM.
    // Paying jsdom's startup cost on every one of them would be wasteful.
    //
    // A component test opts in per file with a docblock on line 1:
    //
    //     // @vitest-environment jsdom
    //
    environment: 'node',

    globals: false,
    include: ['**/*.{test,spec}.{ts,tsx,mts,mjs}'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**', 'solver/**', 'private/**', '.tools/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['app/**', 'lib/**', 'scripts/lib/**'],
      // Proven against a real Postgres by `npm run db:check` / `npm run api:check` instead of
      // vitest — mocking `pg.Pool` to fake a passing test is exactly the hollow coverage
      // docs/ops/testing-strategy.md warns against ("a mocked database tests nothing that
      // matters"). Excluded here rather than counted as untested, the same way `solver/**` has
      // its own gate instead of a vitest number.
      exclude: ['app/api/**', 'lib/server/**', 'scripts/lib/**'],
      // Raised as real modules land, never lowered to make a change pass — see AGENTS.md.
      //
      // Two tiers on purpose. The global floor is held down by `app/`, which is still the
      // stripped scaffold route and has nothing worth testing yet. `lib/analytics/**` is
      // fairness arithmetic that people will be judged by, so it carries a real bar.
      //
      // Each number sits a little below what the suite currently achieves, so an incidental
      // regression is visible without a one-line refactor breaking the build.
      thresholds: {
        lines: 80,
        functions: 85,
        branches: 75,
        statements: 80,
        'lib/analytics/**': { lines: 90, functions: 95, branches: 80, statements: 90 },
        // The export is the artifact of record, so it carries the same bar as the fairness
        // arithmetic. A layout bug prints and looks plausible, which is worse than a crash.
        'lib/export/**': { lines: 90, functions: 95, branches: 80, statements: 90 },
        // The calendar decides which dates are public holidays, and `classifyDay` turns that into a
        // burden weight. A wrong date here is invisible and cumulative, so it carries the same bar.
        'lib/calendar/**': { lines: 90, functions: 95, branches: 80, statements: 90 },
      },
    },
  },
});
