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

function checkWorkflow(relativePath, mode) {
  const workflow = read(relativePath);
  const name = path.basename(relativePath);
  const build = jobBlock(workflow, 'build-image', 'merge-image');
  const merge = jobBlock(workflow, 'merge-image', 'release-smoke');

  checkPins(workflow, name);
  requireText(build, /strategy:\s*\n\s+fail-fast:\s*false\s*\n\s+matrix:\s*\n\s+include:/, `${name} must use an included platform matrix`);
  requireText(build, /platform:\s+linux\/amd64[\s\S]*?pair:\s+amd64[\s\S]*?runner:\s+ubuntu-24\.04(?:\s|$)/, `${name} is missing the native amd64 matrix entry`);
  requireText(build, /platform:\s+linux\/arm64[\s\S]*?pair:\s+arm64[\s\S]*?runner:\s+ubuntu-24\.04-arm(?:\s|$)/, `${name} is missing the native arm64 matrix entry`);
  requireText(build, /runs-on:\s+\$\{\{ matrix\.runner \}\}/, `${name} platform builds must use the matrix runner`);
  requireText(build, /timeout-minutes:\s*45/, `${name} platform builds must retain the 45-minute timeout`);
  if (/setup-qemu-action/.test(build)) fail(`${name} must not use QEMU in native platform build jobs`);
  requireText(build, /platforms:\s+\$\{\{ matrix\.platform \}\}/, `${name} must build one matrix platform per job`);
  requireText(build, /outputs:\s+type=image,name=\$\{\{ env\.REGISTRY \}\}\/\$\{\{ env\.OWNER \}\}\/riviamigo,push-by-digest=true,name-canonical=true,push=true/, `${name} must publish digest-only platform outputs`);
  requireText(build, /provenance:\s*false/, `${name} platform builds must disable per-platform provenance`);
  requireCount(build, /type=registry,ref=\$\{\{ env\.REGISTRY \}\}\/\$\{\{ env\.OWNER \}\}\/riviamigo:buildcache-\$\{\{ matrix\.pair \}\}/g, 2, `${name} must configure one registry cache source and destination`);
  requireText(build, /type=gha,scope=riviamigo-container-image-\$\{\{ matrix\.pair \}\}/, `${name} must retain a per-platform GHA cache`);
  requireText(build, /mode=max,compression=zstd,oci-mediatypes=true,image-manifest=true,ignore-error=true/, `${name} registry cache must use the required export settings`);
  requireText(build, /mode=min,ignore-error=true/, `${name} GHA cache must be a minimal fallback`);
  requireText(build, /actions\/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f/, `${name} must use the pinned upload-artifact action`);
  requireText(build, /retention-days:\s*1/, `${name} platform artifacts must retain for one day`);
  requireText(build, /GITHUB_STEP_SUMMARY/, `${name} must summarize platform timing`);

  requireText(merge, /needs:\s*\[validate(?:-tag)?,\s*build-image\]/, `${name} merge job must wait for validation and both platform builds`);
  requireText(merge, /actions\/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131/, `${name} must use the pinned download-artifact action`);
  requireText(merge, /merge-multiple:\s*true/, `${name} merge job must combine platform artifacts`);
  requireText(merge, /test "\$\{#digest_files\[@\]\}" -eq 2/, `${name} merge must require exactly two digest markers`);
  requireText(merge, /test "\$\{#timing_files\[@\]\}" -eq 2/, `${name} merge must require exactly two timing files`);
  requireText(merge, /imagetools create --metadata-file/, `${name} merge must write manifest metadata`);
  requireText(merge, /containerimage\.descriptor.*containerimage\.digest/s, `${name} merge must support both manifest digest metadata fields`);
  requireText(merge, /attest-build-provenance@0f67c3f4856b2e3261c31976d6725780e5e4c373/, `${name} must attest the merged digest`);
  if (/attest-build-provenance/.test(build)) fail(`${name} provenance attestation must live in merge-image`);

  if (mode === 'stable') {
    requireText(merge, /--tag "\$IMAGE:\$VERSION" --tag "\$IMAGE:latest"/, `${name} stable merge must publish version and latest tags`);
    requireText(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/, `${name} must retain main ancestry validation`);
  } else {
    requireText(merge, /--tag "\$IMAGE:\$VERSION" "\$\{digests\[@\]\}"/, `${name} pre-release merge must publish only the version tag`);
    requireText(workflow, /ref: dev/, `${name} must retain dev source semantics`);
    requireText(workflow, /source_sha:/, `${name} must retain source SHA semantics`);
  }

  requireText(workflow, /needs:\s*\[validate(?:-tag)?,\s*merge-image\]/, `${name} downstream smoke gate must depend on merge-image`);
  requireText(workflow, /needs:\s*\[validate(?:-tag)?,\s*merge-image,\s*release-smoke,\s*populated-upgrade\]/, `${name} release gate must depend on merge-image`);
  requireText(workflow, /needs\.merge-image\.outputs\.digest/, `${name} downstream jobs must consume the merged digest`);
  requireText(
    workflow,
    /verify-fresh-install\.mjs[^\n]*--image-ref "\$\{\{ env\.REGISTRY \}\}\/\$\{\{ env\.OWNER \}\}\/riviamigo@\$\{\{ needs\.merge-image\.outputs\.digest \}\}"/,
    `${name} smoke test must verify the merged digest instead of a mutable tag`
  );
}

checkWorkflow('.github/workflows/publish-release-images.yml', 'stable');
checkWorkflow('.github/workflows/publish-prerelease-images.yml', 'prerelease');

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

if (failures.length) {
  console.error(`Release workflow contract failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Release workflow contract passed.');
}
