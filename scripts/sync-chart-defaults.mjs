import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targetDir = path.join(root, 'apps', 'api', 'charts');
const checkOnly = process.argv.includes('--check');
const files = [
  { source: path.join(root, 'packages', 'dashboards', 'src', 'charts', 'defaults', 'defaults.json'), target: path.join(targetDir, 'defaults.json'), label: 'chart defaults' },
  { source: path.join(root, 'packages', 'dashboards', 'src', 'charts', 'bundled-renderers.json'), target: path.join(targetDir, 'bundled-renderers.json'), label: 'bundled renderer capabilities' },
  { source: path.join(root, 'packages', 'dashboards', 'src', 'charts', 'sources', 'sources.json'), target: path.join(targetDir, 'sources.json'), label: 'chart source manifest' },
];

for (const file of files) {
  const source = fs.readFileSync(file.source, 'utf8');
  const target = fs.existsSync(file.target) ? fs.readFileSync(file.target, 'utf8') : null;
  if (source !== target) {
    if (checkOnly) {
      console.error(`${file.label} drift: ${path.relative(root, file.target)}`);
      process.exitCode = 1;
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(file.target, source);
      console.log(`synced ${path.relative(root, file.target)}`);
    }
  } else if (checkOnly) {
    console.log(`${file.label} are in sync`);
  }
}
