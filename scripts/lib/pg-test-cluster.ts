// Shared lifecycle for a throwaway PostgreSQL cluster started from the pinned `.tools/pgsql`
// binary -- no Docker, no admin rights, matching `setup-postgres.ps1`. Used by every gate that
// needs a real server rather than mocked SQL: `db:check` (schema invariants) and `api:check`
// (the JSON API against a real, RLS-enforced database).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const PG_BIN = join(REPO_ROOT, '.tools', 'pgsql', 'bin');
export const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');

export interface PsqlResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface PgTestCluster {
  readonly host: string;
  readonly port: string;
  /** Wipes any existing data directory, initialises a fresh one, and starts it. For a
   * throwaway cluster this is the only `start` you need; for a persistent one, call it only
   * once (or via `reset`) -- see `startExisting`. */
  start(): void;
  /** Starts an already-initialised data directory without touching its contents. What a
   * persistent dev cluster's normal "start" should call after the first run. */
  startExisting(): void;
  /** Stops the server and deletes the data directory. What a throwaway cluster's teardown
   * should call; a persistent one should use `stopKeepingData` instead. */
  stop(): void;
  /** Stops the server, leaving the data directory in place. */
  stopKeepingData(): void;
  applyMigrations(): void;
  /** A `postgres`-superuser connection string, suitable for `pg.Pool` or the `psql` CLI. */
  connectionString(database?: string): string;
  /** Runs `psql` non-interactively with `-v ON_ERROR_STOP=1` already set. */
  psql(args: readonly string[], input?: string): PsqlResult;
}

function exe(name: string): string {
  const path = join(PG_BIN, `${name}.exe`);
  if (!existsSync(path)) {
    throw new Error(
      `${path} not found. Run 'npm run setup:postgres' first -- it pins the PostgreSQL binaries into .tools/.`,
    );
  }
  return path;
}

export function createPgTestCluster(opts: { pgdata: string; port: string }): PgTestCluster {
  const { pgdata, port } = opts;
  const host = '127.0.0.1';

  function psql(args: readonly string[], input?: string): PsqlResult {
    // `psql` exits 0 even when a statement inside a script fails, unless told otherwise, and
    // `spawnSync` (unlike `execFileSync`) hands back stdout *and* stderr on the success path
    // too -- both matter for a caller whose whole job is telling "succeeded" apart from "failed
    // for the expected reason".
    const result = spawnSync(exe('psql'), args, { input: input ?? '', encoding: 'utf-8' });
    return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  }

  function psqlBase(database = 'postgres'): string[] {
    return ['-h', host, '-p', port, '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'];
  }

  function startExisting(): void {
    execFileSync(
      exe('pg_ctl'),
      [
        '-D',
        pgdata,
        '-l',
        join(pgdata, 'server.log'),
        '-w',
        '-o',
        `-p ${port} -c unix_socket_directories="${pgdata}"`,
        'start',
      ],
      { stdio: 'inherit' },
    );
  }

  function stopKeepingData(): void {
    try {
      execFileSync(exe('pg_ctl'), ['-D', pgdata, '-m', 'fast', 'stop'], { stdio: 'ignore' });
    } catch {
      // Already stopped, or never started -- fine during cleanup.
    }
  }

  return {
    host,
    port,

    start(): void {
      rmSync(pgdata, { recursive: true, force: true });
      mkdirSync(pgdata, { recursive: true });
      // `-E UTF8 --locale=C`: left to its own defaults on this machine, `initdb` picks WIN1252
      // from the OS codepage, which is silently fine right up until a client that declares
      // UTF-8 (the Supabase CLI's Go driver, `pg`, postgres.js) sends a byte sequence WIN1252
      // can't represent -- an emoji in a migration comment surfaced it here, but a doctor's name
      // with a diacritic would surface it in production. Verified 2026-09-07.
      execFileSync(
        exe('initdb'),
        ['-D', pgdata, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'],
        { stdio: 'ignore' },
      );
      startExisting();
    },

    startExisting,
    stopKeepingData,

    stop(): void {
      stopKeepingData();
      rmSync(pgdata, { recursive: true, force: true });
    },

    applyMigrations(): void {
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      if (files.length === 0) {
        throw new Error(`No migrations found in ${MIGRATIONS_DIR}`);
      }
      for (const file of files) {
        const result = psql([...psqlBase(), '-f', join(MIGRATIONS_DIR, file)]);
        if (result.code !== 0) {
          throw new Error(`Migration ${file} failed:\n${result.stderr}`);
        }
      }
    },

    connectionString(database = 'postgres'): string {
      return `postgresql://postgres@${host}:${port}/${database}?sslmode=disable`;
    },

    psql(args: readonly string[], input?: string): PsqlResult {
      return psql([...psqlBase(), ...args], input);
    },
  };
}
