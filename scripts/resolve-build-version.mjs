#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const calendarVersion = /^(\d{4})\.(0[1-9]|1[0-2])\.(\d+)$/;

function compareVersions(a, b) {
  const left = calendarVersion.exec(a).slice(1).map(Number);
  const right = calendarVersion.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/**
 * Release builds report the exact tag. Anything else (a branch, an untagged
 * commit, a dev checkout) reports the highest stable release tag with `+dev`,
 * because the branch is development work on top of that release. The highest
 * tag is used rather than `git describe` since release tags live on main and
 * are often not reachable from dev.
 */
export function latestRelease(allTags) {
  const releases = allTags.filter((tag) => calendarVersion.test(tag));
  if (releases.length === 0) return null;
  return releases.reduce((best, tag) => (compareVersions(tag, best) > 0 ? tag : best));
}

/**
 * With `commitsSince` (candidate images) the suffix becomes `+dev.<N>`, the
 * number of commits since that release; local builds use a bare `+dev`.
 */
export function resolveBuildVersion(allTags, headTags = [], commitsSince = null) {
  const latest = latestRelease(allTags);
  if (!latest) return 'unknown';
  if (headTags.includes(latest)) return latest;
  return commitsSince === null ? `${latest}+dev` : `${latest}+dev.${commitsSince}`;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function resolveBuildVersionFromGit({ candidate = false } = {}) {
  try {
    const tags = git(['tag', '--list']);
    const latest = latestRelease(tags);
    const commitsSince = candidate && latest ? Number(git(['rev-list', '--count', `${latest}..HEAD`])[0]) : null;
    return resolveBuildVersion(tags, git(['tag', '--points-at', 'HEAD']), commitsSince);
  } catch {
    return 'unknown';
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(resolveBuildVersionFromGit({ candidate: process.argv.includes('--candidate') }));
}
