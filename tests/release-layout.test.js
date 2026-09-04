const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

test('Ignis browser companion runtime bundle is present in a source checkout', () => {
  const manifestPath = path.join(ROOT, 'server-plugin', 'obsidian', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const dist = path.join(ROOT, 'server-plugin', 'obsidian', 'dist');

  assert.equal(manifest.id, 'obsidian-local-rest-api');
  assert.ok(fs.statSync(path.join(dist, `${manifest.id}.js`)).size > 0);
  assert.ok(fs.statSync(path.join(dist, `${manifest.id}.css`)).size > 0);
});
