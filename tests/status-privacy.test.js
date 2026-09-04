const test = require('node:test');
const assert = require('node:assert/strict');
const { rootStatusPayload } = require('../server-plugin/lib/routes');

const plugin = { version: '1.0.0' };

test('unauthenticated health payload does not disclose vault or extension names', () => {
  const body = rootStatusPayload(plugin, {
    authenticated: false,
    enabledVaults: ['PrivateVault'],
    apiExtensions: [{id:'private-extension'}],
  });
  assert.equal(body.status, 'OK');
  assert.equal(body.authenticated, false);
  assert.equal('enabledVaults' in body, false);
  assert.equal('apiExtensions' in body, false);
});

test('authenticated health payload includes vault and extension diagnostics', () => {
  const body = rootStatusPayload(plugin, {
    authenticated: true,
    enabledVaults: ['VaultA'],
    apiExtensions: [{id:'example-extension'}],
  });
  assert.deepEqual(body.enabledVaults, ['VaultA']);
  assert.deepEqual(body.apiExtensions, [{id:'example-extension'}]);
});
