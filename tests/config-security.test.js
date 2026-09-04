const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadOrCreateConfig } = require('../server-plugin/lib/config');

test('generated API key is stored but never written to logs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ignis-local-rest-api-config-'));
  const previous = process.env.IGNIS_LOCAL_REST_API_KEY;
  delete process.env.IGNIS_LOCAL_REST_API_KEY;
  const logs = [];
  try {
    const cfg = await loadOrCreateConfig(dir, (line) => logs.push(String(line)));
    assert.match(cfg.apiKey, /^[a-f0-9]{64}$/);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.equal(stored.apiKey, cfg.apiKey);
    assert.equal(logs.some((line) => line.includes(cfg.apiKey)), false);
  } finally {
    if (previous === undefined) delete process.env.IGNIS_LOCAL_REST_API_KEY;
    else process.env.IGNIS_LOCAL_REST_API_KEY = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('environment API key replaces and removes stale persisted generated key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ignis-local-rest-api-env-key-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({apiKey:'stale-generated-key', generatedAt:'2026-01-01T00:00:00.000Z'}), {mode:0o644});
  const previous = process.env.IGNIS_LOCAL_REST_API_KEY;
  process.env.IGNIS_LOCAL_REST_API_KEY = 'runtime-secret-from-environment';
  try {
    const cfg = await loadOrCreateConfig(dir, () => {});
    assert.equal(cfg.apiKey, 'runtime-secret-from-environment');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(stored.apiKey, null);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    if (previous === undefined) delete process.env.IGNIS_LOCAL_REST_API_KEY;
    else process.env.IGNIS_LOCAL_REST_API_KEY = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
