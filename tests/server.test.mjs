import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { applyEdit, calendarDate, createApp, createOwnerVerifier, validateEdit } from '../server/worker.mjs';

const id = '2026-08-04-hs-juan-pena-natural';
const fixture = parse(await readFile(new URL(`../data/coffees/${id}.yaml`, import.meta.url), 'utf8'));
fixture.inventory = { status: 'active', status_date: '2026-08-22' };
fixture.ratings = { overall: null, florality: null, fruitiness: null, brightness: null };
fixture.personal_notes = 'First brew: rose and citrus.\nA second line with café notes.';
const source = stringify(fixture);
const sha = 'a'.repeat(40);
const newSha = 'b'.repeat(40);
const commitSha = 'c'.repeat(40);
const origin = 'https://coffee.example.workers.dev';
const endpoint = `${origin}/owner/api/coffees/${id}`;
const env = {
  ACCESS_TEAM_DOMAIN: 'coffee-team.cloudflareaccess.com',
  ACCESS_AUD: 'd'.repeat(64),
  OWNER_EMAIL: 'owner@example.com',
  GITHUB_OWNER: 'johnbarton',
  GITHUB_REPO: 'coffee-extractor',
  GITHUB_BRANCH: 'main',
  GITHUB_TOKEN: 'test-secret-never-in-responses',
  ASSETS: { fetch: async () => new Response('public coffee site') },
};

function edit(overrides = {}) {
  return { sha, status: 'active', ratings: { ...fixture.ratings }, notes: '', ...overrides };
}

function request(input = edit(), headers = {}, method = 'PUT') {
  return new Request(endpoint, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: method === 'PUT' ? JSON.stringify(input) : undefined,
  });
}

function contentsResponse(yaml = source, fileSha = sha) {
  return Response.json({ type: 'file', encoding: 'base64', size: Buffer.byteLength(yaml), sha: fileSha,
    content: Buffer.from(yaml).toString('base64') });
}

function savedResponse() {
  return Response.json({ content: { sha: newSha }, commit: { sha: commitSha } });
}

function mockApp(replies, options = {}) {
  const calls = [];
  const app = createApp({
    authenticate: async () => ({ owner: true }),
    now: () => new Date('2026-09-12T13:45:00Z'),
    fetcher: async (url, init) => {
      calls.push({ url: String(url), ...init });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      assert.ok(reply, 'Unexpected extra GitHub call');
      return reply;
    },
    ...options,
  });
  return { app, calls };
}

test('public assets do not require owner configuration; owner paths fail closed', async () => {
  const app = createApp();
  const noSecrets = { ASSETS: env.ASSETS };
  const publicPage = await app.fetch(new Request(origin), noSecrets);
  assert.equal(await publicPage.text(), 'public coffee site');
  for (const path of ['/owner', '/owner/', '/owner/api/session', `/owner/api/coffees/${id}`]) {
    const response = await app.fetch(new Request(origin + path), noSecrets);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('missing and forged Access assertions cannot reach the repository', async () => {
  const calls = [];
  const app = createApp({ fetcher: async (...args) => { calls.push(args); throw new Error('Unexpected repository access'); } });
  const absent = await app.fetch(new Request(endpoint), env);
  assert.equal(absent.status, 401);
  const forged = await app.fetch(new Request(endpoint, { headers: { 'Cf-Access-Jwt-Assertion': 'not.a.signature' } }), env);
  assert.equal(forged.status, 401);
  assert.equal(calls.length, 0);
});

test('owner verification checks a real signature, issuer, audience, expiry, required claims, and exact email', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key';
  const urls = [];
  const authenticate = createOwnerVerifier({
    makeKeySet: (url) => {
      urls.push(String(url));
      return createLocalJWKSet({ keys: [publicJwk] });
    },
  });
  const claims = {
    email: 'owner@example.com', sub: 'owner-identity',
    iss: 'https://coffee-team.cloudflareaccess.com', aud: env.ACCESS_AUD,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300,
  };
  async function signedRequest(overrides = {}, key = privateKey) {
    const payload = { ...claims, ...overrides };
    for (const key of Object.keys(payload)) if (payload[key] === undefined) delete payload[key];
    const token = await new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
    return new Request(endpoint, { headers: { 'Cf-Access-Jwt-Assertion': token } });
  }
  assert.deepEqual(await authenticate(await signedRequest(), env), { owner: true });
  assert.deepEqual(urls, ['https://coffee-team.cloudflareaccess.com/cdn-cgi/access/certs']);
  for (const invalid of [
    { iss: 'https://another-team.cloudflareaccess.com' },
    { aud: 'other-application' }, { exp: claims.iat - 10 }, { exp: undefined },
    { iat: undefined }, { sub: undefined }, { email: undefined },
  ]) {
    await assert.rejects(() => signedRequest(invalid).then((req) => authenticate(req, env)), { status: 401 });
  }
  await assert.rejects(() => signedRequest({ email: 'other@gmail.com' }).then((req) => authenticate(req, env)), { status: 403 });
  const otherKeys = await generateKeyPair('RS256');
  await assert.rejects(() => signedRequest({}, otherKeys.privateKey).then((req) => authenticate(req, env)), { status: 401 });
  // A self-reported identity header is not a substitute for the signed assertion.
  await assert.rejects(() => authenticate(new Request(endpoint, { headers: { 'Cf-Access-Authenticated-User-Email': env.OWNER_EMAIL } }), env), { status: 401 });
});

test('owner page and session are uncached, and credentials are not passed to public assets', async () => {
  let assetRequest;
  const app = createApp({ authenticate: async () => ({ owner: true }) });
  const response = await app.fetch(new Request(`${origin}/owner?draft=anything`, {
    headers: { Cookie: 'private-cookie', 'Cf-Access-Jwt-Assertion': 'private-assertion' },
  }), { ...env, ASSETS: { fetch: async (req) => { assetRequest = req; return new Response('app', { headers: { 'Cache-Control': 'public, max-age=600' } }); } } });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(assetRequest.url, `${origin}/`);
  assert.equal(assetRequest.headers.get('Cookie'), null);
  assert.equal(assetRequest.headers.get('Cf-Access-Jwt-Assertion'), null);
  const session = await app.fetch(new Request(`${origin}/owner/api/session`), env);
  assert.deepEqual(await session.json(), { owner: true });
  assert.equal(session.headers.get('Cache-Control'), 'no-store');
});

test('GET reads the fixed repository path and returns a normalized coffee and its SHA', async () => {
  const { app, calls } = mockApp([contentsResponse()]);
  const response = await app.fetch(new Request(endpoint), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sha, sha);
  assert.equal(body.coffee.id, id);
  assert.equal(body.coffee.name, 'Juan Peña');
  assert.equal(body.coffee.status, 'active');
  assert.equal(body.coffee.personalNotes, fixture.personal_notes);
  assert.equal(calls[0].url, `https://api.github.com/repos/johnbarton/coffee-extractor/contents/data/coffees/${id}.yaml?ref=main`);
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(calls[0].headers.Authorization, `Bearer ${env.GITHUB_TOKEN}`);
  assert.ok(!JSON.stringify(body).includes(env.GITHUB_TOKEN));
});

test('PUT rejects cross-origin, missing origin, and non-JSON requests before fetching records', async () => {
  const { app, calls } = mockApp([]);
  assert.equal((await app.fetch(request(edit(), { Origin: 'https://evil.example' }), env)).status, 403);
  const missingOrigin = request();
  missingOrigin.headers.delete('Origin');
  assert.equal((await app.fetch(missingOrigin, env)).status, 403);
  assert.equal((await app.fetch(request(edit(), { 'Sec-Fetch-Site': 'cross-site' }), env)).status, 403);
  assert.equal((await app.fetch(request(edit(), { 'Content-Type': 'text/plain' }), env)).status, 415);
  assert.equal(calls.length, 0);
});

test('invalid IDs, unknown routes, and unsupported methods cannot write to GitHub', async () => {
  const { app, calls } = mockApp([]);
  for (const path of ['/owner/api/coffees/invalid', '/owner/api/coffees/%2E%2E%2Fsecret', '/owner/api/other', `/owner/api/coffees/${id}/extra`]) {
    assert.equal((await app.fetch(new Request(origin + path), env)).status, 404);
  }
  for (const path of ['/owner', '/owner/api/session', `/owner/api/coffees/${id}`]) {
    assert.equal((await app.fetch(new Request(origin + path, { method: 'DELETE' }), env)).status, 405);
  }
  assert.equal(calls.length, 0);
});

test('edit validation only accepts the narrow record fields and complete integer ratings', () => {
  assert.equal(validateEdit(edit()).status, 'active');
  for (const invalid of [
    edit({ coffee: { name: 'Changed' } }), edit({ personal_notes: 'Replace everything' }),
    edit({ status: 'open' }), edit({ sha: '../../other-file' }),
    edit({ ratings: { ...fixture.ratings, fruitiness: 0 } }),
    edit({ ratings: { ...fixture.ratings, overall: 6 } }),
    edit({ ratings: { ...fixture.ratings, overall: 4.5 } }),
    edit({ ratings: { ...fixture.ratings, overall: '4' } }),
    edit({ ratings: { overall: 4 } }),
    edit({ ratings: { ...fixture.ratings, extra: 3 } }),
    edit({ notes: 123 }), edit({ notes: 'x'.repeat(8001) }), edit({ notes: 'null\u0000byte' }),
  ]) assert.throws(() => validateEdit(invalid), { status: 400 });
});

test('body limit applies to streamed bytes even without Content-Length', async () => {
  const { app, calls } = mockApp([]);
  const response = await app.fetch(new Request(endpoint, {
    method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: ' '.repeat(64 * 1024 + 1),
  }), env);
  assert.equal(response.status, 413);
  const malformed = await app.fetch(new Request(endpoint, {
    method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{',
  }), env);
  assert.equal(malformed.status, 400);
  assert.equal(calls.length, 0);
});

test('patch preserves unrelated fields and comments, appends notes, and dates status changes in New York', () => {
  const commented = `# Preserve this record comment\n${source.replace('name: Juan Peña', 'name: Juan Peña # Preserve this inline comment')}`;
  const updated = applyEdit(commented, id, edit({ status: 'frozen', ratings: { ...fixture.ratings, overall: 5 }, notes: '  Lovely sweetness ☕\nTry cooler water.  ' }), new Date('2026-09-13T01:00:00Z'));
  assert.equal(updated.changed, true);
  assert.equal(updated.record.inventory.status, 'frozen');
  assert.equal(updated.record.inventory.status_date, '2026-09-12');
  assert.equal(updated.record.ratings.overall, 5);
  assert.equal(updated.record.personal_notes, `${fixture.personal_notes}\n\nLovely sweetness ☕\nTry cooler water.`);
  for (const key of Object.keys(fixture).filter((key) => !['ratings', 'inventory', 'personal_notes'].includes(key))) {
    assert.deepEqual(updated.record[key], fixture[key]);
  }
  assert.match(updated.source, /# Preserve this record comment/);
  assert.match(updated.source, /# Preserve this inline comment/);
  assert.equal(calendarDate(new Date('2026-01-03T04:30:00Z')), '2026-01-02');
});

test('rating-only changes preserve status_date; unchanged whitespace notes leave exact YAML untouched', () => {
  const updated = applyEdit(source, id, edit({ ratings: { ...fixture.ratings, brightness: 3 } }));
  assert.equal(updated.record.inventory.status_date, fixture.inventory.status_date);
  const unchanged = applyEdit(source, id, edit({ notes: ' \n\t ' }));
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.source, source);
  const cleared = applyEdit(source, id, edit({ status: null }), new Date('2026-09-12T12:00:00Z'));
  assert.equal(cleared.record.inventory.status, null);
  assert.equal(cleared.record.inventory.status_date, '2026-09-12');
});

test('schema-invalid YAML, duplicate keys, aliases, and mismatched record IDs cannot be edited', () => {
  for (const invalid of [
    source.replace('name: Juan Peña', 'name: 42'),
    `${source}\nid: ${id}\n`,
    source.replace(`id: ${id}`, 'id: 2026-08-04-other-coffee'),
  ]) {
    assert.throws(() => applyEdit(invalid, id, edit()), { status: 422 });
  }
  const aliased = source.replace('name: Juan Peña', 'name: &name Juan Peña').replace('producer: Juan Peña', 'producer: *name');
  assert.throws(() => applyEdit(aliased, id, edit()), { status: 422 });
});

test('successful PUT commits only allowed changes against the original SHA and branch', async () => {
  const { app, calls } = mockApp([contentsResponse(), savedResponse()]);
  const response = await app.fetch(request(edit({ status: 'finished', notes: 'Clean finish — buy again.' })), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sha, newSha);
  assert.equal(body.commit, commitSha);
  assert.equal(body.unchanged, false);
  assert.equal(body.coffee.status, 'finished');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].redirect, 'manual');
  const sent = JSON.parse(calls[1].body);
  assert.equal(sent.sha, sha);
  assert.equal(sent.branch, 'main');
  const saved = parse(Buffer.from(sent.content, 'base64').toString('utf8'));
  assert.equal(saved.personal_notes, `${fixture.personal_notes}\n\nClean finish — buy again.`);
  assert.deepEqual(saved.source_images, fixture.source_images);
  assert.deepEqual(saved.coffee, fixture.coffee);
  assert.equal(body.coffee.statusDate, '2026-09-12');
});

test('unchanged edits avoid a commit; stale records return conflict without writing', async () => {
  const unchanged = mockApp([contentsResponse()]);
  const result = await unchanged.app.fetch(request(), env);
  const body = await result.json();
  assert.equal(body.unchanged, true);
  assert.equal(body.commit, null);
  assert.equal(unchanged.calls.length, 1);
  const stale = mockApp([contentsResponse(source, newSha)]);
  const conflict = await stale.app.fetch(request(edit({ notes: 'Do not overwrite newer edits.' })), env);
  assert.equal(conflict.status, 409);
  assert.equal(stale.calls.length, 1);
});

test('concurrent GitHub change returns a conflict without retrying the write', async () => {
  const { app, calls } = mockApp([contentsResponse(), Response.json({ message: 'SHA changed' }, { status: 409 })]);
  const response = await app.fetch(request(edit({ notes: 'New note' })), env);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'conflict');
  assert.equal(calls.length, 2);
});

test('ambiguous save errors never retry and tell the client to check the current record', async () => {
  for (const reply of [new Error(`Network error containing ${env.GITHUB_TOKEN}`), new Response('upstream unavailable', { status: 503 }), new Response('malformed success')]) {
    const { app, calls } = mockApp([contentsResponse(), reply]);
    const response = await app.fetch(request(edit({ notes: 'A note to append once.' })), env);
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.code, 'save_uncertain');
    assert.equal(body.saveMayHaveSucceeded, true);
    assert.ok(!JSON.stringify(body).includes(env.GITHUB_TOKEN));
    assert.equal(calls.length, 2);
  }
});

test('GitHub redirects fail without following the location or retrying a write', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const redirect = () => new Response(null, { status, headers: { Location: 'https://other.example/record' } });
    const read = mockApp([redirect()]);
    const loaded = await read.app.fetch(new Request(endpoint), env);
    assert.equal(loaded.status, 502);
    assert.equal((await loaded.json()).code, 'record_unavailable');
    assert.equal(read.calls.length, 1);
    assert.equal(read.calls[0].redirect, 'manual');

    const write = mockApp([contentsResponse(), redirect()]);
    const saved = await write.app.fetch(request(edit({ notes: 'One intended note.' })), env);
    assert.equal(saved.status, 502);
    assert.equal((await saved.json()).code, 'save_uncertain');
    assert.equal(write.calls.length, 2);
    assert.ok(write.calls.every((call) => call.redirect === 'manual'));
    assert.ok(write.calls.every((call) => new URL(call.url).hostname === 'api.github.com'));
  }
});

test('GitHub failures, oversized files, and invalid YAML never expose upstream details or write', async () => {
  for (const reply of [
    Response.json({ message: `private upstream ${env.GITHUB_TOKEN}` }, { status: 403 }),
    contentsResponse(source.replace('name: Juan Peña', 'name: 42')),
    Response.json({ type: 'file', encoding: 'base64', size: 999999, sha, content: '' }),
  ]) {
    const { app, calls } = mockApp([reply]);
    const response = await app.fetch(request(edit({ notes: 'New note' })), env);
    assert.ok([422, 502].includes(response.status));
    assert.ok(!(await response.text()).includes(env.GITHUB_TOKEN));
    assert.equal(calls.length, 1);
  }
});
