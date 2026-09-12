import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));

// The supported Wrangler harness runs the real local Workers asset service.
// This test does not open a browser or use any account credentials.
test('Cloudflare runtime serves public assets and protects the owner route', { timeout: 60000 }, async (t) => {
  process.env.WRANGLER_SEND_METRICS = 'false';
  process.env.WRANGLER_LOG_PATH ||= resolve(tmpdir(), 'coffee-collection-runtime-tests.log');
  await promisify(execFile)(process.execPath, ['scripts/build.mjs'], { cwd: root });
  const { createTestHarness } = await import('wrangler');
  const { createApp } = await import('../server/worker.mjs');
  const server = createTestHarness({
    root,
    workers: [{
      configPath: './wrangler.jsonc',
      // Override even a developer's local secret file so auth stays fail-closed.
      secrets: { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', OWNER_EMAIL: '', GITHUB_TOKEN: '' },
    }],
  });
  t.after(() => server.close());
  await server.listen();
  const expectedHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');

  await t.test('the root serves the built index with real security headers', async () => {
    const response = await server.fetch('/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /^text\/html/);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self'/);
    assert.equal(await response.text(), expectedHtml);
  });

  await t.test('the index app and its matching coffee data are available at public paths', async () => {
    const scriptPath = expectedHtml.match(/<script[^>]+src="([^"]+)"/)?.[1];
    assert.match(scriptPath, /^\/app\.[a-f0-9]+\.js$/);
    const scriptResponse = await server.fetch(scriptPath);
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get('Content-Type'), /javascript/);
    const script = await scriptResponse.text();
    const dataPath = script.match(/\/coffees\.[a-f0-9]+\.json/)?.[0];
    assert.ok(dataPath, 'Built JavaScript must reference its matching coffee data');
    const dataResponse = await server.fetch(dataPath);
    assert.equal(dataResponse.status, 200);
    assert.match(dataResponse.headers.get('Content-Type'), /application\/json/);
    const coffees = await dataResponse.json();
    const expected = JSON.parse(await readFile(resolve(root, `dist${dataPath}`), 'utf8'));
    assert.deepEqual(coffees, expected);
    assert.ok(coffees.length > 0);
    for (const path of ['/styles.css', '/favicon.svg', '/manifest.webmanifest', '/version.json']) {
      const response = await server.fetch(path);
      assert.equal(response.status, 200, `${path} must be public`);
      await response.arrayBuffer();
    }
    const missing = await server.fetch('/missing-asset.js');
    assert.equal(missing.status, 404);
    await missing.arrayBuffer();
  });

  await t.test('every owner entry reaches the Worker and fails closed without secrets', async () => {
    for (const path of ['/owner', '/owner/', '/owner/api/session']) {
      const response = await server.fetch(path);
      assert.equal(response.status, 503, `${path} must reach the auth guard`);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal((await response.json()).code, 'owner_unavailable');
    }
  });

  await t.test('authenticated owner rewriting serves the actual index through the ASSETS binding', async () => {
    const { ASSETS } = await server.getWorker().getEnv();
    assert.equal(typeof ASSETS.fetch, 'function');
    // Authentication alone is mocked in this test; routing and ASSETS are real.
    // The deployed default export has no authentication bypass.
    const app = createApp({ authenticate: async () => ({ owner: true }) });
    for (const path of ['/owner', '/owner/']) {
      const response = await app.fetch(new Request(`https://coffee.example${path}`), { ASSETS });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.match(response.headers.get('Content-Type'), /^text\/html/);
      assert.equal(await response.text(), expectedHtml);
    }
  });
});
