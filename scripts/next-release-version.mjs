#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

const calendarVersion = /^(\d{4})\.(0[1-9]|1[0-2])\.(\d+)$/;

export function nextReleaseVersion(tags, month) {
  if (!/^\d{4}\.(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`Invalid Calendar Version month: ${month}`);
  }

  let highestPatch = -1;
  for (const tag of tags) {
    const match = calendarVersion.exec(tag);
    if (match?.[1] === month.slice(0, 4) && match[2] === month.slice(5)) {
      highestPatch = Math.max(highestPatch, Number.parseInt(match[3], 10));
    }
  }

  return `${month}.${highestPatch + 1}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const monthIndex = args.indexOf('--month');
  if (monthIndex === -1 || !args[monthIndex + 1]) {
    throw new Error('Usage: next-release-version.mjs --month YYYY.MM [existing tags...]');
  }
  const month = args[monthIndex + 1];
  const tags = args.slice(monthIndex + 2);
  console.log(nextReleaseVersion(tags, month));
}
