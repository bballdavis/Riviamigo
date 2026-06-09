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
  "docs/architecture/overview.md",
  "docs/architecture/backend-data-flow.md",
  "docs/runbooks/README.md",
  "docs/runbooks/documentation-maintenance.md",
  "docs/wiki-drafts/README.md",
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
  "docs/architecture/overview.md",
  "docs/architecture/backend-data-flow.md",
  "docs/runbooks/README.md",
  "docs/runbooks/documentation-maintenance.md",
  "docs/wiki-drafts/README.md",
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

const requiredWikiDrafts = [
  "00-Home.md",
  "01-Feature-Overview.md",
  "02-Quick-Start.md",
  "03-Prerequisites.md",
  "04-Architecture-Summary.md",
  "05-Coding-Conventions.md",
  "06-Development-Setup.md",
  "10-Environment-Variables.md",
  "11-Docker-Compose-Deployment.md",
  "12-Rivian-Account-Setup.md",
  "13-API-Keys.md",
  "14-Grafana-Integration.md",
  "15-Backup-and-Restore.md",
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
  const envFiles = [".env.example", "apps/api/.env.example", "apps/web/.env.example"];
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

function checkWikiDrafts() {
  const wikiDir = path.join(repoRoot, "docs/wiki-drafts");
  const existing = new Set(fs.readdirSync(wikiDir));
  for (const fileName of requiredWikiDrafts) {
    if (!existing.has(fileName)) {
      fail(`missing required wiki draft: docs/wiki-drafts/${fileName}`);
    }
  }

  const draftFiles = [...existing].filter((name) => name.endsWith(".md") && name !== "README.md");
  const publishedNames = new Map();
  for (const fileName of draftFiles) {
    const publishedName = fileName.replace(/^[0-9]+-/, "");
    const prior = publishedNames.get(publishedName);
    if (prior) {
      fail(`wiki draft publish collision: ${prior} and ${fileName} both map to ${publishedName}`);
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
    "docs/wiki-drafts/10-Environment-Variables.md",
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

checkRequiredFiles();
checkMarkdownLinks();
checkWikiDrafts();
checkRouteContracts();
checkApiContracts();
checkEnvVarReferences();

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("docs:check passed");
