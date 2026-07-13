import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "docs/index.md",
  "docs/branding.md",
  "docs/contributing.md",
  "docs/decision-log.md",
  "docs/security.md",
  "docs/security-audit.md",
  "docs/roadmap.md",
  "docs/privacy.md",
  "docs/architecture/overview.md",
  "docs/architecture/backend-data-flow.md",
  "docs/runbooks/README.md",
  "docs/runbooks/documentation-maintenance.md",
  "docs/guides/README.md",
  "scripts/publish-wiki.sh",
];

const docsFilesToCheck = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "docs/index.md",
  "docs/branding.md",
  "docs/contributing.md",
  "docs/decision-log.md",
  "docs/security.md",
  "docs/security-audit.md",
  "docs/roadmap.md",
  "docs/privacy.md",
  "docs/architecture/overview.md",
  "docs/architecture/backend-data-flow.md",
  "docs/runbooks/README.md",
  "docs/runbooks/documentation-maintenance.md",
  "docs/guides/README.md",
];

const routeSlugs = [
  "index",
  "battery",
  "battery.phantom-drain",
  "charging",
  "charging.$sessionId",
  "connect",
  "connect.otp",
  "d.$slug",
  "efficiency",
  "health",
  "login",
  "settings",
  "trips",
  "trips.$tripId",
  "users",
];

const requiredApiRouteFiles = [
  "auth.rs",
  "vehicles.rs",
  "battery.rs",
  "trips.rs",
  "charging.rs",
  "efficiency.rs",
  "health.rs",
];

const requiredGuides = [
  "README.md",
  "features.md",
  "getting-started.md",
  "prerequisites.md",
  "configuration.md",
  "deployment.md",
  "rivian-account.md",
  "backup-and-restore.md",
  "secure-deployment.md",
];

function fail(message) {
  console.error(`docs:check failed: ${message}`);
  process.exitCode = 1;
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function collectEnvVars() {
  const envFiles = ["compose/.env.example", "compose/.env.full.example", "apps/api/.env.example", "apps/web/.env.example"];
  const names = new Set();

  for (const relativePath of envFiles) {
    if (!fileExists(relativePath)) {
      continue;
    }
    const content = readFile(relativePath);
    for (const match of content.matchAll(/([A-Z][A-Z0-9_]+)=/g)) {
      names.add(match[1]);
    }
  }

  const configContent = readFile("apps/api/src/config.rs");
  for (const match of configContent.matchAll(/"([A-Z0-9_]+)"/g)) {
    names.add(match[1]);
  }

  return names;
}

function checkRequiredFiles() {
  for (const relativePath of requiredFiles) {
    if (!fileExists(relativePath)) {
      fail(`missing required file: ${relativePath}`);
    }
  }
}

function checkMarkdownLinks() {
  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

  for (const relativePath of docsFilesToCheck) {
    const content = readFile(relativePath);
    const baseDir = path.dirname(path.join(repoRoot, relativePath));

    for (const match of content.matchAll(markdownLinkPattern)) {
      const target = match[1].trim();
      if (
        !target ||
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("mailto:") ||
        target.startsWith("#")
      ) {
        continue;
      }

      const normalizedTarget = target.split("#")[0];
      const resolved = path.resolve(baseDir, normalizedTarget);
      if (!fs.existsSync(resolved)) {
        fail(`broken markdown link in ${relativePath}: ${target}`);
      }
    }
  }
}

function checkGuides() {
  const guidesDir = path.join(repoRoot, "docs/guides");
  const existing = new Set(fs.readdirSync(guidesDir));
  for (const fileName of requiredGuides) {
    if (!existing.has(fileName)) {
      fail(`missing required guide: docs/guides/${fileName}`);
    }
  }

  const guideFiles = [...existing].filter((name) => name.endsWith(".md") && name !== "README.md");
  const publishedNames = new Map();
  for (const fileName of guideFiles) {
    const publishedName = fileName;
    const prior = publishedNames.get(publishedName);
    if (prior) {
      fail(`guide publish collision: ${prior} and ${fileName} both map to ${publishedName}`);
    }
    publishedNames.set(publishedName, fileName);
  }
}

function checkRouteContracts() {
  const routeDir = path.join(repoRoot, "apps/web/src/routes");
  const existing = new Set(
    fs
      .readdirSync(routeDir)
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => name.replace(/\.tsx$/, "")),
  );

  for (const slug of routeSlugs) {
    if (!existing.has(slug)) {
      fail(`expected route slug missing from apps/web/src/routes: ${slug}`);
    }
  }
}

function checkApiContracts() {
  const routeDir = path.join(repoRoot, "apps/api/src/routes");
  const routeFiles = new Set(fs.readdirSync(routeDir).filter((name) => name.endsWith(".rs")));

  for (const routeFile of requiredApiRouteFiles) {
    if (!routeFiles.has(routeFile)) {
      fail(`expected API route module missing from apps/api/src/routes: ${routeFile}`);
    }
  }
}

function checkEnvVarReferences() {
  const knownEnvVars = collectEnvVars();
  const envReferencePattern = /`([A-Z][A-Z0-9_]+)`/g;
  const docFiles = [
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "docs/index.md",
    "docs/contributing.md",
    "docs/runbooks/documentation-maintenance.md",
    "docs/guides/configuration.md",
  ];

  for (const relativePath of docFiles) {
    const content = readFile(relativePath);
    for (const match of content.matchAll(envReferencePattern)) {
      const name = match[1];
      if (
        name === "PATH" ||
        name === "HOME" ||
        name === "CI"
      ) {
        continue;
      }
      if (!knownEnvVars.has(name)) {
        fail(`unknown env var referenced in ${relativePath}: ${name}`);
      }
    }
  }
}

function checkProductionDeploymentContract() {
  const productionCompose = readFile("compose/docker-compose.prod.yml");
  const nginxConfig = readFile("compose/nginx/nginx.conf");

  for (const requiredSnippet of [
    '"127.0.0.1:${RIVIAMIGO_ORIGIN_PORT:-8080}:8080"',
    "JWT_SECRET: ${JWT_SECRET}",
    "JWT_PUBLIC_KEY: ${JWT_PUBLIC_KEY}",
    "AGE_ENCRYPTION_KEY: ${AGE_ENCRYPTION_KEY}",
    "redis:",
    "context: ../apps/api",
  ]) {
    if (!productionCompose.includes(requiredSnippet)) {
      fail(`production compose is missing required secure-deployment contract: ${requiredSnippet}`);
    }
  }

  for (const forbiddenSnippet of ['"80:80"', '"443:443"', "COOKIE_INSECURE:"]) {
    if (productionCompose.includes(forbiddenSnippet)) {
      fail(`production compose must not include direct-public deployment setting: ${forbiddenSnippet}`);
    }
  }

  for (const requiredSnippet of ["resolver 127.0.0.11", "http://api:3001", "listen 8080;"]) {
    if (!nginxConfig.includes(requiredSnippet)) {
      fail(`nginx must use the internal secure-deployment topology: ${requiredSnippet}`);
    }
  }
}

checkRequiredFiles();
checkMarkdownLinks();
checkGuides();
checkRouteContracts();
checkApiContracts();
checkEnvVarReferences();
checkProductionDeploymentContract();

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("docs:check passed");
