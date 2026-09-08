import next from 'eslint-config-next';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // private/ is gitignored and holds real patient-adjacent personal data; .tools/ is
    // pinned third-party binaries; solver/ is Python and is linted by Ruff instead.
    ignores: [
      '.next/**',
      '.tools/**',
      'coverage/**',
      'dist/**',
      'graphify-out/**',
      'next-env.d.ts',
      'node_modules/**',
      'private/**',
      'solver/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  // Next.js rules: react-hooks/exhaustive-deps and the Next-specific checks are the
  // reason ESLint stays in this project at all rather than being replaced by Biome.
  ...next,

  // Type-aware TypeScript rules. This is the layer Biome and oxlint do not yet replace.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    rules: {
      // A roster engine is arrays indexed by day and by doctor, so
      // noUncheckedIndexedAccess earns its keep — and the tempting way to silence it
      // is a non-null assertion, which throws the safety away. Narrow properly.
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Solver results and preference payloads cross a Python boundary. An unchecked
      // `any` there defeats the whole point of the generated contract types.
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // Node-side tooling scripts are plain ESM, outside the tsconfig project.
  {
    files: ['scripts/**/*.mjs', '*.config.ts', '*.config.mts'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Formatting is Biome's job, not ESLint's.
  {
    rules: {
      '@typescript-eslint/no-extra-semi': 'off',
    },
  },
);
