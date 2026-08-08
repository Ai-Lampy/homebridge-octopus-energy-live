import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lines = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);
const heading = `## [${packageJson.version}]`;
const start = lines.findIndex((line) => line.startsWith(heading));

if (start < 0) {
  throw new Error(`CHANGELOG.md has no release section for ${packageJson.version}`);
}

const nextRelease = lines.findIndex((line, index) => index > start && /^## \[/.test(line));
const end = nextRelease < 0 ? lines.length : nextRelease;
const notes = lines.slice(start, end).join('\n').trim();

if (!notes) {
  throw new Error(`CHANGELOG.md release section for ${packageJson.version} is empty`);
}

process.stdout.write(`${notes}\n`);
