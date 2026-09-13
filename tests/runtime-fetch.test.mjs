import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Node accepts fetch options that workerd rejects. Exercise the production
// record requests in workerd, using a fixture service instead of the network.
test('Cloudflare runtime can load and save an owner record with native fetch options', { timeout: 60000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'coffee-runtime-fetch-'));
  process.env.WRANGLER_SEND_METRICS = 'false';
  process.env.WRANGLER_LOG_PATH = join(tmpdir(), 'coffee-runtime-fetch.log');
  const id = '2026-08-04-hs-juan-pena-natural';
  const source = await readFile(new URL(`../data/coffees/${id}.yaml`, import.meta.url), 'utf8');
  const sha = 'a'.repeat(40);
  const nextSha = 'b'.repeat(40);
  const commit = 'c'.repeat(40);
  const workerPath = fileURLToPath(new URL('../server/worker.mjs', import.meta.url));

  await writeFile(join(root, 'owner.mjs'), `
    import { createApp } from ${JSON.stringify(workerPath)};
    export default {
      fetch(request, env) {
        return createApp({
          authenticate: async () => ({ owner: true }),
          fetcher: (url, options) => env.GITHUB.fetch(url, options),
        }).fetch(request, env);
      },
    };
  `);
  await writeFile(join(root, 'github.mjs'), `
    export default {
      async fetch(request) {
        if (request.method === 'GET') return Response.json({
          type: 'file', encoding: 'base64', sha: ${JSON.stringify(sha)},
          size: ${Buffer.byteLength(source)},
          content: ${JSON.stringify(Buffer.from(source).toString('base64'))},
        });
        if (request.method === 'PUT') return Response.json({
          content: { sha: ${JSON.stringify(nextSha)} },
          commit: { sha: ${JSON.stringify(commit)} },
        });
        return new Response('Unexpected method', { status: 405 });
      },
    };
  `);
  const baseConfig = { compatibility_date: '2026-09-12', workers_dev: false, preview_urls: false };
  await writeFile(join(root, 'owner.json'), JSON.stringify({
    ...baseConfig, name: 'coffee-runtime-owner-fixture', main: './owner.mjs',
    vars: {
      GITHUB_OWNER: 'johnbarton', GITHUB_REPO: 'coffee-extractor', GITHUB_BRANCH: 'main',
      GITHUB_TOKEN: 'test-fixture-only',
    },
    services: [{ binding: 'GITHUB', service: 'coffee-runtime-github-fixture' }],
  }));
  await writeFile(join(root, 'github.json'), JSON.stringify({
    ...baseConfig, name: 'coffee-runtime-github-fixture', main: './github.mjs',
  }));
  const { createTestHarness } = await import('wrangler');
  const server = createTestHarness({ root, workers: [
    { configPath: './owner.json' }, { configPath: './github.json' },
  ] });
  t.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  });
  await server.listen();

  const origin = 'https://coffee.example';
  const endpoint = `${origin}/owner/api/coffees/${id}`;
  const loadedResponse = await server.fetch(endpoint);
  const loaded = await loadedResponse.json();
  assert.equal(loadedResponse.status, 200, JSON.stringify(loaded));
  assert.equal(loaded.coffee.id, id);
  assert.equal(loaded.sha, sha);

  const savedResponse = await server.fetch(endpoint, {
    method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sha: loaded.sha, status: loaded.coffee.status,
      ratings: { overall: null, florality: null, fruitiness: null, brightness: null },
      notes: 'Runtime test note.',
    }),
  });
  const saved = await savedResponse.json();
  assert.equal(savedResponse.status, 200, JSON.stringify(saved));
  assert.equal(saved.sha, nextSha);
  assert.equal(saved.commit, commit);
  assert.match(saved.coffee.personalNotes, /Runtime test note\.$/);
});
