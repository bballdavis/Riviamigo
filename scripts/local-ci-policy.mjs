/** Paths whose changes need the database-backed API gate before a push. */
const API_GATE_PATHS = ['apps/api/'];

/**
 * Chooses the verification gate for a Git hook.
 *
 * - `bypass`: SKIP_LOCAL_CI=1, an emergency escape hatch.
 * - `full`:   RIVIAMIGO_FULL_LOCAL_CI=1, the complete CI-parity gate.
 * - `api`:    a push whose branch changes the Rust API. Runs format, Clippy,
 *             and the database-backed API tests against the isolated local CI
 *             database, which is the class of failure the fast gate misses.
 * - `local`:  the fast hygiene and migration-integrity gate.
 */
export function selectHookGate(env = {}, { hook = 'pre-commit', changedPaths = [] } = {}) {
  if (env.SKIP_LOCAL_CI === '1') return 'bypass';
  if (env.RIVIAMIGO_FULL_LOCAL_CI === '1') return 'full';
  if (hook === 'pre-push' && changedPaths.some((path) => API_GATE_PATHS.some((prefix) => path.startsWith(prefix)))) {
    return 'api';
  }
  return 'local';
}

/**
 * Picks the integration branch a feature branch most likely targets: the
 * candidate whose merge base leaves the fewest commits on the branch.
 * Candidates without a merge base (`aheadCount` null) are ignored.
 */
export function selectPushBase(candidates) {
  const usable = candidates.filter((candidate) => candidate.mergeBase && Number.isInteger(candidate.aheadCount));
  if (usable.length === 0) return null;
  return usable.reduce((best, candidate) => (candidate.aheadCount < best.aheadCount ? candidate : best));
}

/**
 * Arguments for `gh pr create`. `pnpm pr:create -- <args>` forwards the `--`
 * separator to the script, and `gh` would treat everything after it as
 * positional, so drop a leading separator.
 */
export function ghPrCreateArgs(args) {
  return args[0] === '--' ? args.slice(1) : [...args];
}
