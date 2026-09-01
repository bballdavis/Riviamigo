import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) fail(`Missing ${relativePath}`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function requireText(text, pattern, message) {
  if (!pattern.test(text)) fail(message);
}

function requireCount(text, pattern, expected, message) {
  const count = text.match(pattern)?.length ?? 0;
  if (count !== expected) fail(`${message} (found ${count}, expected ${expected})`);
}

function jobBlock(workflow, job, nextJob) {
  const start = workflow.indexOf(`  ${job}:`);
  if (start < 0) {
    fail(`${job} job is missing`);
    return '';
  }
  const end = nextJob ? workflow.indexOf(`\n  ${nextJob}:`, start) : workflow.length;
  if (end < 0) {
    fail(`${nextJob} job boundary is missing after ${job}`);
    return workflow.slice(start);
  }
  return workflow.slice(start, end);
}

function checkPins(workflow, name) {
  const references = [...workflow.matchAll(/^\s*-?\s*uses:\s*[^\s@]+@([0-9a-f]+)(?:\s|$)/gim)];
  for (const reference of references) {
    if (reference[1].length !== 40) fail(`${name} contains an unpinned or short action SHA: ${reference[1]}`);
  }
}

function checkPromotionWorkflow(relativePath, mode) {
  const workflow = read(relativePath);
  const name = path.basename(relativePath);
  const promote = jobBlock(workflow, 'promote-image', 'release-smoke');

  checkPins(workflow, name);
  if (/docker\/build-push-action/.test(workflow)) fail(`${name} must promote a candidate instead of rebuilding the image`);
  requireText(workflow, /include_arm64:[\s\S]*?default:\s*false/, `${name} must keep ARM64 opt-in`);
  requireText(promote, /candidate-\$SOURCE_SHA-amd64/, `${name} must require the exact AMD64 commit candidate`);
  requireText(promote, /candidate-\$SOURCE_SHA-arm64/, `${name} must support an optional exact ARM64 candidate`);
  requireText(promote, /imagetools create --metadata-file/, `${name} must promote candidates by immutable manifest`);
  requireText(promote, /containerimage\.descriptor.*containerimage\.digest/s, `${name} must capture the promoted digest`);
  requireText(promote, /attest-build-provenance@0f67c3f4856b2e3261c31976d6725780e5e4c373/, `${name} must attest the promoted digest`);

  if (mode === 'stable') {
    requireText(promote, /--tag "\$IMAGE:\$VERSION" --tag "\$IMAGE:latest"/, `${name} stable promotion must publish version and latest tags`);
    requireText(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/, `${name} must retain main ancestry validation`);
  } else {
    requireText(promote, /--tag "\$IMAGE:\$VERSION" "\$\{sources\[@\]\}"/, `${name} preview promotion must publish only the version tag`);
    requireText(workflow, /ref: dev/, `${name} must retain dev source semantics`);
    requireText(workflow, /source_sha:/, `${name} must retain source SHA semantics`);
  }

  requireText(workflow, /needs:\s*\[validate(?:-tag)?,\s*promote-image\]/, `${name} downstream gates must depend on promotion`);
  requireText(workflow, /needs:\s*\[validate(?:-tag)?,\s*promote-image,\s*release-smoke,\s*populated-upgrade\]/, `${name} release creation must wait for promoted-image verification`);
  requireText(workflow, /needs\.promote-image\.outputs\.digest/, `${name} downstream jobs must consume the promoted digest`);
  requireText(
    workflow,
    /verify-fresh-install\.mjs[^\n]*--image-ref "\$\{\{ env\.REGISTRY \}\}\/\$\{\{ env\.OWNER \}\}\/riviamigo@\$\{\{ needs\.promote-image\.outputs\.digest \}\}"/,
    `${name} smoke test must verify the promoted digest instead of a mutable tag`
  );
}

function checkCandidateWorkflow() {
  const workflow = read('.github/workflows/publish-candidate-image.yml');
  checkPins(workflow, 'publish-candidate-image.yml');
  requireText(workflow, /branches:\s*\[main, dev\]/, 'candidate workflow must build every main and dev commit');
  requireText(workflow, /runs-on:\s*ubuntu-24\.04(?:\s|$)/, 'AMD64 candidates must use the native AMD64 runner');
  requireText(workflow, /runs-on:\s*ubuntu-24\.04-arm(?:\s|$)/, 'ARM64 candidates must use the native ARM64 runner');
  requireText(workflow, /Build candidate \(arm64, manual\)/, 'ARM64 candidate builds must remain manual');
  requireCount(workflow, /cache-from:\s*type=registry,ref=.*buildcache-(?:amd64|arm64)-v2/g, 2, 'candidate workflow must import one GHCR cache per platform');
  requireCount(workflow, /cache-to:\s*type=registry,ref=.*buildcache-(?:amd64|arm64)-v2/g, 2, 'candidate workflow must export one GHCR cache per platform');
  if (/type=gha/.test(workflow)) fail('candidate workflow must not consume GitHub Actions cache storage for BuildKit');
  requireText(workflow, /candidate-\$\{\{ needs\.resolve\.outputs\.source_sha \}\}-amd64/, 'candidate workflow must publish an exact AMD64 commit tag');
  requireText(workflow, /candidate-\$\{\{ needs\.resolve\.outputs\.source_sha \}\}-arm64/, 'candidate workflow must publish an exact ARM64 commit tag');
  requireText(workflow, /prune-candidates:[\s\S]*?keep=10[\s\S]*?keep=3/, 'candidate workflow must bound AMD64 and ARM64 candidate retention');
  requireText(workflow, /gh api --method DELETE[^\n]*packages\/container\/riviamigo\/versions\/\$id/, 'candidate workflow must delete stale candidate versions by exact package version ID');
  requireText(workflow, /\^\[0-9a-f\]\{7\}-dev\$/, 'candidate workflow must remove orphaned legacy dev candidates without matching the moving dev tag');
  for (const [job, nextJob] of [['build-amd64', 'build-arm64'], ['build-arm64', 'prune-candidates']]) {
    const block = jobBlock(workflow, job, nextJob);
    requireCount(block, /Apply pnpm patch compatibility overlay/g, 1, `${job} must apply the pnpm patch compatibility overlay once`);
    const compatibility = block.indexOf("if grep -Fq \"$compatibility\"");
    const historical = block.indexOf("grep -Fq 'RUN pnpm install --frozen-lockfile'");
    if (compatibility < 0 || historical < 0 || compatibility > historical) {
      fail(`${job} must check compatibility before the historical install seam`);
    }
    requireCount(block, /contents\.count\(old\) != 1/g, 1, `${job} must require exactly one historical install seam`);
  }
}

checkCandidateWorkflow();
checkPromotionWorkflow('.github/workflows/publish-release-images.yml', 'stable');
checkPromotionWorkflow('.github/workflows/publish-prerelease-images.yml', 'prerelease');

const quality = read('.github/workflows/quality.yml');
requireText(quality, /run:\s*pnpm release-workflows:check/, 'quality workflow must invoke the release workflow checker');
const packageJson = JSON.parse(read('package.json'));
if (packageJson.scripts?.['release-workflows:check'] !== 'node ./scripts/check-release-workflows.mjs') {
  fail('package.json must expose release-workflows:check');
}
const compose = read('compose/docker-compose.yml');
requireText(compose, /image: \$\{RIVIAMIGO_IMAGE:-/, 'production Compose must accept an exact image reference');
const freshInstall = read('scripts/verify-fresh-install.mjs');
requireText(freshInstall, /const imageRef = value\('--image-ref'\)/, 'fresh-install verification must accept --image-ref');
requireText(freshInstall, /RIVIAMIGO_IMAGE: imageRef/, 'fresh-install verification must pass the exact image reference to Compose');
requireText(
  freshInstall,
  /restart', 'riviamigo'[\s\S]*?verifyBundledDashboards\(baseUrl, accessToken\)/,
  'fresh-install verification must prove pre-restart access tokens survive a service restart',
);
const runtime = read('.github/workflows/runtime.yml');
requireText(
  runtime,
  /RIVIAMIGO_ENV:\s*development/,
  'runtime workflow must explicitly classify its local dependency stack as development',
);
requireText(
  runtime,
  /cargo run --bin riviamigo-api/,
  'runtime workflow must select the API binary explicitly',
);
if (/docker compose[^\n]*\sbuild(?:\s|$)/.test(runtime)) {
  fail('runtime workflow must reuse the commit candidate instead of rebuilding the production image');
}
requireText(
  runtime,
  /imagetools inspect "ghcr\.io\/bballdavis\/riviamigo:candidate-\$\{GITHUB_SHA\}-amd64"/,
  'runtime workflow must verify the exact AMD64 commit candidate',
);
const freshInstallWorkflow = read('.github/workflows/fresh-install.yml');
requireText(
  freshInstallWorkflow,
  /pnpm verify:fresh-install -- --mode "\$\{\{ inputs\.mode \|\| 'production' \}\}" --production-env "\$fresh_env" --source-build/,
  'fresh-install workflow must exercise the production acceptance path',
);
if (/secrets\.FRESH_INSTALL_(?:JWT_SECRET|JWT_PUBLIC_KEY|AGE_ENCRYPTION_KEY)/.test(freshInstallWorkflow)) {
  fail('fresh-install workflow must validate generated key persistence without repository key secrets');
}
const backupRestoreS3 = read('scripts/verify-backup-restore-s3.mjs');
requireText(
  backupRestoreS3,
  /chown 1001:1001 \/data\/backups \/data\/cache/,
  'S3 drill must prepare disposable bind mounts for the production container user',
);
requireText(
  backupRestoreS3,
  /prepareDataDirectory\(sourceData\);[\s\S]*?startStack\(sourceProject/,
  'S3 drill must prepare the source bind mount before starting its stack',
);
requireText(
  backupRestoreS3,
  /prepareDataDirectory\(targetData\);[\s\S]*?startStack\(targetProject/,
  'S3 drill must prepare the target bind mount before starting its stack',
);
requireText(
  backupRestoreS3,
  /waitForBackupCompletion\(sourceUrl, sourceToken, backup\.run\.id\)/,
  'S3 drill must wait for the asynchronous backup run before restoring it',
);
requireText(
  backupRestoreS3,
  /run\?\.status === 'succeeded'[\s\S]*?storage_type === 'local'[\s\S]*?storage_type === 's3'/,
  'S3 drill must require both local and S3 artifacts from the completed run',
);
requireText(
  backupRestoreS3,
  /phase === 'failed'[\s\S]*?job\.error_message/,
  'S3 drill must surface terminal restore-agent errors instead of swallowing them',
);
requireText(
  backupRestoreS3,
  /RUST_LOG=riviamigo_api=info,riviamigo_restore_agent=error,tower_http=info/,
  'S3 drill must retain restore-agent error diagnostics',
);

if (failures.length) {
  console.error(`Release workflow contract failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Release workflow contract passed.');
}
