import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

/**
 * End-to-end tests for the seed-data validator.
 *
 * The point of these is not coverage. The validator is the only thing standing between a
 * mis-transcribed historical roster and a fairness ledger that is quietly wrong, and the
 * real source is known to contain errors - a coverage gap on one Wednesday, a duplicated
 * shift time on one Tuesday, a mislabelled spill cell. So the validator's *failure* path
 * matters more than its success path, and an unproven check is not a check.
 */

const script = path.join('scripts', 'validate-seed-data.mjs');

function runOn(dir) {
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
}

describe('validate-seed-data', () => {
  it('accepts the valid synthetic fixture', () => {
    const result = runOn(path.join('fixtures', 'seed-data'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 error(s)');
  });

  it('accepts a declared missing-shift anomaly as a warning, not an error', () => {
    const result = runOn(path.join('fixtures', 'seed-data'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('declared anomaly, accepted');
  });

  describe('the deliberately broken fixture', () => {
    const result = runOn(path.join('fixtures', 'seed-data', 'invalid'));
    const output = result.stdout + result.stderr;

    it('fails with a non-zero exit code', () => {
      expect(result.status).toBe(1);
    });

    it('catches a doctor assigned twice in one day (H-02)', () => {
      expect(output).toContain('assigned more than once (H-02)');
    });

    it('catches a shift that does not belong to its declared pattern', () => {
      expect(output).toContain('is not part of pattern');
    });

    it('catches an UNdeclared missing shift', () => {
      expect(output).toContain('but it is absent');
    });

    it('catches missing days and names them', () => {
      expect(output).toMatch(/3 of 28 days present/);
      expect(output).toContain('Missing: 2027-02-04');
    });
  });

  it('skips cleanly when the directory does not exist', () => {
    // A clone without private/ must not fail the gate for that reason alone.
    const result = runOn(path.join('fixtures', 'seed-data', 'does-not-exist'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no seed data found');
  });
});
