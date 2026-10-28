import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mdiIconPaths, resolveMdiIconPath } from '../src/plugins/mdiIcons.js';

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(vue|js|mjs)$/.test(entry.name) ? [full] : [];
  }));
  return files.flat();
}

test('every mdi-* icon name used in src has an SVG path', async () => {
  const used = new Set();
  for (const file of await listSourceFiles('src')) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/['"`](mdi-[a-z0-9-]+)['"`]/g)) {
      used.add(match[1]);
    }
  }
  assert.ok(used.size > 0);
  const missing = [...used].filter((name) => !mdiIconPaths[name]);
  assert.deepEqual(missing, []);
});

test('resolveMdiIconPath maps names and passes raw paths through', () => {
  assert.match(resolveMdiIconPath('mdi-close'), /^M/);
  assert.equal(resolveMdiIconPath('M0,0L1,1Z'), 'M0,0L1,1Z');
});
