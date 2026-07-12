import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourceDir = path.join(repoRoot, "packages", "dashboards", "src", "defaults");
const targetDir = path.join(repoRoot, "apps", "api", "dashboards");
const systemDashboardFiles = [
  "dashboard.json",
  "battery.json",
  "efficiency.json",
  "charging.json",
  "trips.json",
];
const checkOnly = process.argv.includes("--check");

let driftFound = false;

for (const fileName of systemDashboardFiles) {
  const sourcePath = path.join(sourceDir, fileName);
  const targetPath = path.join(targetDir, fileName);
  const source = fs.readFileSync(sourcePath, "utf8");
  const target = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : null;

  if (target === source) continue;

  if (checkOnly) {
    console.error(`dashboard defaults drift: ${path.relative(repoRoot, targetPath)}`);
    driftFound = true;
    continue;
  }

  fs.writeFileSync(targetPath, source);
  console.log(`synced ${path.relative(repoRoot, targetPath)}`);
}

if (driftFound) {
  process.exitCode = 1;
} else if (checkOnly) {
  console.log("dashboard defaults are in sync");
}
