import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../packages/domain/src/', import.meta.url).pathname;
const forbidden = [
  '@prisma/', 'prisma', 'bullmq', 'ioredis', 'redis',
  'openai', '@anthropic-ai/', '@google/', 'github', '@octokit/'
];

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await files(p));
    else if (/\.(ts|tsx|mts|cts)$/.test(e.name)) out.push(p);
  }
  return out;
}

let failed = false;
for (const file of await files(root)) {
  const text = await readFile(file, 'utf8');
  for (const token of forbidden) {
    if (text.includes(`from '${token}`) || text.includes(`from \"${token}`)) {
      console.error(`Forbidden domain dependency in ${file}: ${token}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log('Architecture check passed.');
