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
  "docs/environment-variables.md",
  "docs/architecture/overview.md",
  "docs/architecture/backend-data-flow.md",
  "docs/development.md",
  "docs/using-riviamigo.md",
  "docs/operations.md",
  "docs/reference.md",
  "docs/runbooks/README.md",
  "docs/runbooks/documentation-maintenance.md",
  "docs/guides/README.md",
  "docs/guides/verify-installation.md",
  "apps/docs/docusaurus.config.ts",
  "apps/docs/sidebars.ts",
  "apps/docs/src/pages/index.tsx",
];

function collectMarkdownFiles(relativeDir) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  const found = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name).replaceAll(path.sep, "/");
    if (entry.isDirectory()) {
      found.push(...collectMarkdownFiles(relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(relativePath);
    }
  }
  return found;
}

const docsFilesToCheck = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  ...collectMarkdownFiles("docs"),
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
  "verify-installation.md",
  "dashboard-customization.md",
  "external-connections.md",
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
  const envFiles = ["compose/.env.example", "compose/.env.full.example"];
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

function checkDocusaurusContracts() {
  const config = readFile("apps/docs/docusaurus.config.ts");
  const sidebars = readFile("apps/docs/sidebars.ts");

  for (const requiredSnippet of [
    "url: 'https://riviamigo.com'",
    "baseUrl: '/'",
    "path: '../../docs'",
    "routeBasePath: 'docs'",
    "onBrokenLinks: 'throw'",
    "onBrokenAnchors: 'throw'",
    "@cmfcmf/docusaurus-search-local",
    "label: 'User Guide'",
    "label: 'Operations'",
    "label: 'Reference'",
  ]) {
    if (!config.includes(requiredSnippet)) {
      fail(`Docusaurus config is missing required publishing contract: ${requiredSnippet}`);
    }
  }

  for (const sidebarName of [
    "overviewSidebar",
    "gettingStartedSidebar",
    "usingRiviamigoSidebar",
    "operationsSidebar",
    "developmentSidebar",
    "referenceSidebar",
  ]) {
    if (!sidebars.includes(sidebarName)) {
      fail(`Docusaurus sidebars are missing required functional section: ${sidebarName}`);
    }
  }

  for (const relativePath of collectMarkdownFiles("docs")) {
    const docId = relativePath.replace(/^docs\//, "").replace(/\.md$/, "");
    const quotedId = new RegExp(`[\"']${docId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"']`, "g");
    const occurrences = [...sidebars.matchAll(quotedId)].length;
    if (occurrences !== 1) {
      fail(`expected ${docId} to appear in exactly one Docusaurus sidebar; found ${occurrences}`);
    }
  }
}

function checkLegacyWikiReferences() {
  const files = [
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    ...collectMarkdownFiles("docs"),
  ];
  const forbidden = [
    "github.com/bballdavis/Riviamigo/wiki",
    "scripts/publish-wiki.sh",
    ".github/workflows/publish-wiki.yml",
    "Wiki publishing",
    "publish to the Wiki",
    "publish through the Wiki",
  ];

  for (const relativePath of files) {
    const content = readFile(relativePath);
    for (const snippet of forbidden) {
      if (content.includes(snippet)) {
        fail(`legacy Wiki publishing reference in ${relativePath}: ${snippet}`);
      }
    }
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
    "docs/environment-variables.md",
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

function checkEnvironmentReferenceCoverage() {
  const fullTemplate = readFile("compose/.env.full.example");
  const reference = readFile("docs/environment-variables.md");
  const supported = new Set(
    [...fullTemplate.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]),
  );

  for (const name of supported) {
    if (!reference.includes(`\`${name}\``)) {
      fail(`environment reference is missing supported variable: ${name}`);
    }
  }

  const configContent = readFile("apps/api/src/config.rs");
  const configBlock = configContent.slice(
    configContent.indexOf("pub struct Config"),
    configContent.indexOf("pub struct RateLimitConfig"),
  );
  const runtimeFields = [...configBlock.matchAll(/pub ([a-z][a-z0-9_]+):/g)]
    .map((match) => match[1].toUpperCase())
    .filter((name) => name !== "RATE_LIMIT");
  const rateBlock = configContent.slice(
    configContent.indexOf("pub struct RateLimitConfig"),
    configContent.indexOf("fn default_port"),
  );
  const rateFields = [...rateBlock.matchAll(/pub ([a-z][a-z0-9_]+):/g)]
    .map((match) => `RATE_LIMIT_${match[1].toUpperCase()}`);
  const directRuntimeVars = ["RIVIAN_GRAPHQL_GATEWAY_URL", "RUST_LOG"];
  for (const name of [...runtimeFields, ...rateFields, ...directRuntimeVars]) {
    if (!supported.has(name)) {
      fail(`compose/.env.full.example is missing runtime variable: ${name}`);
    }
  }

  const productionCompose = readFile("compose/docker-compose.yml");
  for (const match of productionCompose.matchAll(/\$\{([A-Z][A-Z0-9_]+)/g)) {
    if (!supported.has(match[1])) {
      fail(`compose/.env.full.example is missing production Compose variable: ${match[1]}`);
    }
  }
}

function checkProductionDeploymentContract() {
  const productionCompose = readFile("compose/docker-compose.yml");
  const buildCompose = readFile("compose/docker-compose.build.yml");
  const nginxConfig = readFile("compose/nginx/nginx.conf");

  for (const requiredSnippet of [
    '"127.0.0.1:${RIVIAMIGO_ORIGIN_PORT:-8080}:8080"',
    "RIVIAMIGO_ENV: production",
    "ghcr.io/bballdavis}/riviamigo:${IMAGE_TAG:-latest}",
    "../data/db:/db",
    "../data/backups:/backups",
    "../data/cache:/cache",
    "redis:",
  ]) {
    if (!productionCompose.includes(requiredSnippet)) {
      fail(`production compose is missing required secure-deployment contract: ${requiredSnippet}`);
    }
  }

  for (const forbiddenSnippet of ['"80:80"', '"443:443"', "COOKIE_INSECURE:", "  nginx:"]) {
    if (productionCompose.includes(forbiddenSnippet)) {
      fail(`production compose must not include direct-public deployment setting: ${forbiddenSnippet}`);
    }
  }

  for (const requiredSnippet of ["context: ..", "dockerfile: compose/Dockerfile"]) {
    if (!buildCompose.includes(requiredSnippet)) {
      fail(`build overlay is missing required source-build contract: ${requiredSnippet}`);
    }
  }

  if (productionCompose.includes("build:")) {
    fail("standard Compose must pull published images instead of defining build contexts");
  }

  for (const requiredSnippet of ["http://127.0.0.1:3001", "listen 8080;"]) {
    if (!nginxConfig.includes(requiredSnippet)) {
      fail(`nginx must use the internal secure-deployment topology: ${requiredSnippet}`);
    }
  }
}

checkRequiredFiles();
checkMarkdownLinks();
checkGuides();
checkDocusaurusContracts();
checkLegacyWikiReferences();
checkRouteContracts();
checkApiContracts();
checkEnvVarReferences();
checkEnvironmentReferenceCoverage();
checkProductionDeploymentContract();

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("docs:check passed");
