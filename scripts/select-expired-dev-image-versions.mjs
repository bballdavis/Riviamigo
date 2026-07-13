#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shaTag = /^sha-[0-9a-f]{12,64}$/;

export function selectExpiredDevelopmentVersionIds(payload, before) {
  const cutoff = new Date(before).getTime();
  if (!Number.isFinite(cutoff)) throw new Error(`Invalid cutoff timestamp: ${before}`);

  const versions = (Array.isArray(payload) ? payload : [payload]).flat(Infinity);
  return versions
    .filter((version) => version && typeof version === 'object')
    .filter((version) => {
      const tags = version.metadata?.container?.tags;
      const created = new Date(version.created_at).getTime();
      return Array.isArray(tags)
        && tags.length > 0
        && tags.every((tag) => shaTag.test(tag))
        && Number.isFinite(created)
        && created < cutoff;
    })
    .map((version) => String(version.id));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [before, file] = process.argv.slice(2);
  if (!before || !file) {
    throw new Error('Usage: select-expired-dev-image-versions.mjs <ISO cutoff> <versions.json>');
  }
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  process.stdout.write(selectExpiredDevelopmentVersionIds(payload, before).join('\n'));
}
