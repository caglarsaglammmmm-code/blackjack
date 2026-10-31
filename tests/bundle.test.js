import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBundle } from '../tools/bundle-file.mjs';

test('js/app.file.js güncel (değilse: npm run bundle)', () => {
  const normalize = (text) => text.replace(/\r\n/g, '\n');
  assert.equal(normalize(fs.readFileSync('js/app.file.js', 'utf8')), normalize(buildBundle()));
});

test('sw.js önbellek listesindeki tüm dosyalar var', () => {
  const sw = fs.readFileSync('sw.js', 'utf8');
  const list = sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].match(/'[^']+'/g).map((item) => item.slice(1, -1));
  for (const file of list) {
    if (file !== './') assert.ok(fs.existsSync(file), file);
  }
  for (const file of fs.readdirSync('fonts').filter((name) => name.endsWith('.woff2'))) {
    assert.ok(list.includes(`fonts/${file}`), file);
  }
});
