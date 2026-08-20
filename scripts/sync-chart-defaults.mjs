import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'packages', 'dashboards', 'src', 'charts', 'defaults', 'defaults.json');
const targetDir = path.join(root, 'apps', 'api', 'charts');
const targetPath = path.join(targetDir, 'defaults.json');
const checkOnly = process.argv.includes('--check');
const source = fs.readFileSync(sourcePath, 'utf8');
const target = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;
if (source !== target) {
  if (checkOnly) {
    console.error(`chart defaults drift: ${path.relative(root, targetPath)}`);
    process.exitCode = 1;
  } else {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, source);
    console.log(`synced ${path.relative(root, targetPath)}`);
  }
} else if (checkOnly) {
  console.log('chart defaults are in sync');
}
