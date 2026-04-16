#!/usr/bin/env node
import { readFile, writeFile, rm } from 'node:fs/promises';
import { execSync } from 'node:child_process';

const arg = process.argv[2];

const resolveVersion = async () => {
  if (arg) {
    if (!/^\d+\.\d+\.\d+$/.test(arg)) {
      console.error(`Invalid version "${arg}". Expected format: x.y.z (e.g., 1.1.4)`);
      process.exit(1);
    }
    return arg;
  }
  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version);
  if (!match) {
    console.error(`Cannot parse manifest.json version "${manifest.version}"`);
    process.exit(1);
  }
  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
};

const version = await resolveVersion();
console.log(`Releasing v${version}`);

const bumpVersion = async (path) => {
  const raw = await readFile(path, 'utf8');
  const data = JSON.parse(raw);
  data.version = version;
  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  await writeFile(path, JSON.stringify(data, null, 2) + trailingNewline);
};

await bumpVersion('manifest.json');
await bumpVersion('package.json');

execSync('vite build', { stdio: 'inherit' });

await rm('dist.zip', { force: true });
execSync('zip -r ../dist.zip .', { stdio: 'inherit', cwd: 'dist' });

console.log(`Released v${version} -> dist.zip`);
