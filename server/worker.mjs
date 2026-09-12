import { createRemoteJWKSet, jwtVerify } from 'jose';
import { parseDocument } from 'yaml';
import validateRecord from '../generated/validate-record.mjs';
import { normalizeCoffee } from '../shared/coffee.mjs';

const ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const STATUSES = new Set([null, 'resting', 'active', 'frozen', 'finished']);
const RATING_KEYS = ['overall', 'florality', 'fruitiness', 'brightness'];
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_ADDED_NOTES = 8000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

class RequestError extends Error {
  constructor(status, code, message, extras = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extras = extras;
  }
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function ownerResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function accessConfig(env) {
  const rawDomain = String(env.ACCESS_TEAM_DOMAIN || '').trim();
  const domain = rawDomain.replace(/^https:\/\//, '').replace(/\/$/, '');
  const audience = String(env.ACCESS_AUD || '').trim();
  const email = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/i.test(domain)
    || !/^[a-zA-Z0-9_-]{16,256}$/.test(audience)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RequestError(503, 'owner_unavailable', 'Owner access is not configured yet.');
  }
  return { issuer: `https://${domain.toLowerCase()}`, audience, email };
}

// A signed Access assertion is required even if an Access path rule is missing.
// Dependencies are injectable for tests; the deployed Worker always uses jose.
export function createOwnerVerifier({ verify = jwtVerify, makeKeySet = createRemoteJWKSet } = {}) {
  const keySets = new Map();
  return async function verifyOwner(request, env) {
    const config = accessConfig(env);
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token || token.length > 16 * 1024) {
      throw new RequestError(401, 'sign_in_required', 'Sign in to edit your coffee collection.');
    }
    let payload;
    try {
      let keys = keySets.get(config.issuer);
      if (!keys) {
        keys = makeKeySet(new URL(`${config.issuer}/cdn-cgi/access/certs`));
        keySets.set(config.issuer, keys);
      }
      ({ payload } = await verify(token, keys, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ['RS256'],
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'email'],
      }));
    } catch {
      throw new RequestError(401, 'sign_in_required', 'Your sign-in could not be verified. Sign in again.');
    }
    if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== config.email) {
      throw new RequestError(403, 'owner_only', 'This account cannot edit the collection.');
    }
    return { owner: true };
  };
}

export function calendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateEdit(input) {
  const allowed = ['sha', 'status', 'ratings', 'notes'];
  if (!plainObject(input)
    || Object.keys(input).length !== allowed.length
    || !Object.keys(input).every((key) => allowed.includes(key))) {
    throw new RequestError(400, 'invalid_edit', 'Only status, ratings, and added notes can be saved.');
  }
  if (typeof input.sha !== 'string' || !SHA_PATTERN.test(input.sha)) {
    throw new RequestError(400, 'invalid_edit', 'Reload this coffee before saving.');
  }
  if (!STATUSES.has(input.status)) {
    throw new RequestError(400, 'invalid_edit', 'Choose a valid coffee status.');
  }
  if (!plainObject(input.ratings)
    || Object.keys(input.ratings).length !== RATING_KEYS.length
    || !Object.keys(input.ratings).every((key) => RATING_KEYS.includes(key))
    || !RATING_KEYS.every((key) => input.ratings[key] === null
      || (Number.isInteger(input.ratings[key]) && input.ratings[key] >= 1 && input.ratings[key] <= 5))) {
    throw new RequestError(400, 'invalid_edit', 'Each rating must be blank or a whole number from 1 to 5.');
  }
  if (typeof input.notes !== 'string' || input.notes.length > MAX_ADDED_NOTES || input.notes.includes('\u0000')) {
    throw new RequestError(400, 'invalid_edit', `Added notes must be text of at most ${MAX_ADDED_NOTES} characters.`);
  }
  return input;
}

async function readLimitedBody(body, maximum, tooLarge) {
  if (!body) return '';
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw tooLarge;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let position = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, position);
      position += chunk.byteLength;
    }
    return decoder.decode(bytes);
  } finally {
    reader.releaseLock();
  }
}

async function readEdit(request) {
  const url = new URL(request.url);
  if (request.headers.get('Origin') !== url.origin
    || (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) {
    throw new RequestError(403, 'invalid_origin', 'Open the editor on this site before saving.');
  }
  if (request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415, 'json_required', 'Send changes as JSON.');
  }
  const tooLarge = new RequestError(413, 'edit_too_large', 'These changes are too large to save.');
  const statedLength = request.headers.get('Content-Length');
  if (statedLength !== null && (!/^\d+$/.test(statedLength) || Number(statedLength) > MAX_REQUEST_BYTES)) {
    throw tooLarge;
  }
  let input;
  try {
    input = JSON.parse(await readLimitedBody(request.body, MAX_REQUEST_BYTES, tooLarge));
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'invalid_json', 'These changes could not be read.');
  }
  return validateEdit(input);
}

function repositoryConfig(env) {
  const owner = String(env.GITHUB_OWNER || '').trim();
  const repo = String(env.GITHUB_REPO || '').trim();
  const branch = String(env.GITHUB_BRANCH || '').trim();
  const token = String(env.GITHUB_TOKEN || '').trim();
  const validSegment = (value) => /^[a-zA-Z0-9_.-]+$/.test(value) && value !== '.' && value !== '..';
  if (!validSegment(owner) || !validSegment(repo) || !branch || branch.length > 255 || /[\u0000-\u0020]/.test(branch) || !token) {
    throw new RequestError(503, 'saving_unavailable', 'The connection to your coffee records is not configured yet.');
  }
  return { owner, repo, branch, token };
}

function contentsUrl(config, id, reading = false) {
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/data/coffees/${id}.yaml`);
  if (reading) url.searchParams.set('ref', config.branch);
  return url;
}

function githubHeaders(config) {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'coffee-collection-worker',
  };
}

function decodeBase64(value) {
  const bytes = Uint8Array.from(atob(value.replace(/\s/g, '')), (character) => character.charCodeAt(0));
  return decoder.decode(bytes);
}

function encodeBase64(value) {
  let binary = '';
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function githubJson(response) {
  try {
    return JSON.parse(await readLimitedBody(response.body, MAX_RECORD_BYTES * 2,
      new RequestError(502, 'record_unavailable', 'This coffee record could not be loaded.')));
  } catch {
    throw new RequestError(502, 'record_unavailable', 'This coffee record could not be loaded.');
  }
}

function parseRecord(source, id) {
  try {
    const document = parseDocument(source, { uniqueKeys: true, strict: true });
    const record = document.toJS({ maxAliasCount: 0 });
    if (document.errors.length || !validateRecord(record) || record.id !== id) throw new Error('Invalid record');
    return { document, record };
  } catch {
    throw new RequestError(422, 'invalid_record', 'This coffee record needs a check in the repository before it can be edited.');
  }
}

async function loadRecord(config, id, fetcher) {
  let response;
  try {
    response = await fetcher(contentsUrl(config, id, true), {
      headers: githubHeaders(config),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new RequestError(502, 'record_unavailable', 'Your coffee record could not be loaded. Try again in a moment.');
  }
  if (response.status === 404) throw new RequestError(404, 'not_found', 'This coffee was not found.');
  if (!response.ok) throw new RequestError(502, 'record_unavailable', 'Your coffee record could not be loaded. Try again in a moment.');
  const data = await githubJson(response);
  if (data.type !== 'file' || data.encoding !== 'base64' || !SHA_PATTERN.test(data.sha)
    || typeof data.content !== 'string' || data.size > MAX_RECORD_BYTES) {
    throw new RequestError(502, 'record_unavailable', 'This coffee record could not be loaded.');
  }
  let source;
  try {
    source = decodeBase64(data.content);
    if (encoder.encode(source).byteLength > MAX_RECORD_BYTES) throw new Error('Record too large');
  } catch {
    throw new RequestError(502, 'record_unavailable', 'This coffee record could not be loaded.');
  }
  return { ...parseRecord(source, id), source, sha: data.sha };
}

export function applyEdit(source, id, edit, now = new Date()) {
  validateEdit(edit);
  return patchRecord({ ...parseRecord(source, id), source }, edit, now);
}

function patchRecord({ document, record, source }, edit, now) {
  let changed = false;
  if (record.inventory.status !== edit.status) {
    document.setIn(['inventory', 'status'], edit.status);
    document.setIn(['inventory', 'status_date'], calendarDate(now));
    changed = true;
  }
  for (const key of RATING_KEYS) {
    if (record.ratings[key] !== edit.ratings[key]) {
      document.setIn(['ratings', key], edit.ratings[key]);
      changed = true;
    }
  }
  const newNotes = edit.notes.trim();
  if (newNotes) {
    document.set('personal_notes', record.personal_notes ? `${record.personal_notes}\n\n${newNotes}` : newNotes);
    changed = true;
  }
  if (!changed) return { record, source, changed: false };
  const updated = document.toJS({ maxAliasCount: 0 });
  if (!validateRecord(updated)) {
    throw new RequestError(422, 'invalid_record', 'These changes do not match the coffee record format.');
  }
  const updatedSource = document.toString({ lineWidth: 0 });
  if (encoder.encode(updatedSource).byteLength > MAX_RECORD_BYTES) {
    throw new RequestError(413, 'record_too_large', 'This coffee has too many notes to save more through the website.');
  }
  return { record: updated, source: updatedSource, changed: true };
}

async function saveRecord(config, id, current, edit, fetcher, now) {
  if (edit.sha !== current.sha) {
    throw new RequestError(409, 'conflict', 'This coffee changed since you opened it. Reload its latest record before saving.');
  }
  const updated = patchRecord(current, edit, now);
  if (!updated.changed) {
    return { coffee: normalizeCoffee(updated.record), sha: current.sha, commit: null, unchanged: true };
  }
  let response;
  try {
    response = await fetcher(contentsUrl(config, id), {
      method: 'PUT',
      headers: { ...githubHeaders(config), 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        message: `Update ratings, status, or notes for ${id}`,
        content: encodeBase64(updated.source),
        sha: current.sha,
        branch: config.branch,
      }),
    });
  } catch {
    // A network failure after PUT may still have committed. Never retry it here.
    throw uncertainSave();
  }
  if (response.status === 409 || response.status === 422) {
    throw new RequestError(409, 'conflict', 'The repository changed or could not accept this edit. Reload the record before trying again.');
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new RequestError(502, 'save_rejected', 'GitHub could not accept this edit. Check the repository connection before trying again.');
  }
  if (!response.ok) throw uncertainSave();
  let data;
  try {
    data = await githubJson(response);
    if (!SHA_PATTERN.test(data.content?.sha) || !SHA_PATTERN.test(data.commit?.sha)) throw new Error('Invalid save response');
  } catch {
    throw uncertainSave();
  }
  return { coffee: normalizeCoffee(updated.record), sha: data.content.sha, commit: data.commit.sha, unchanged: false };
}

function uncertainSave() {
  return new RequestError(502, 'save_uncertain', 'The save could not be confirmed. Reload the latest record and check your notes before trying again.', {
    saveMayHaveSucceeded: true,
  });
}

export function createApp({ authenticate = createOwnerVerifier(), fetcher = fetch, now = () => new Date() } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path !== '/owner' && !path.startsWith('/owner/')) return env.ASSETS.fetch(request);
      try {
        await authenticate(request, env);
        if (path === '/owner' || path === '/owner/') {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            return json({ error: 'Method not allowed.', code: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
          }
          url.pathname = '/';
          url.search = '';
          // Do not pass the Access JWT or cookie through to the public asset response.
          return ownerResponse(await env.ASSETS.fetch(new Request(url, { method: request.method })));
        }
        if (path === '/owner/api/session') {
          if (request.method !== 'GET') return json({ error: 'Method not allowed.', code: 'method_not_allowed' }, 405, { Allow: 'GET' });
          return json({ owner: true });
        }
        const match = path.match(/^\/owner\/api\/coffees\/([^/]+)$/);
        if (!match || !ID_PATTERN.test(match[1]) || match[1].length > 200) {
          throw new RequestError(404, 'not_found', 'This page was not found.');
        }
        if (request.method !== 'GET' && request.method !== 'PUT') {
          return json({ error: 'Method not allowed.', code: 'method_not_allowed' }, 405, { Allow: 'GET, PUT' });
        }
        const edit = request.method === 'PUT' ? await readEdit(request) : null;
        const config = repositoryConfig(env);
        const id = match[1];
        const current = await loadRecord(config, id, fetcher);
        if (!edit) return json({ coffee: normalizeCoffee(current.record), sha: current.sha });
        return json(await saveRecord(config, id, current, edit, fetcher, now()));
      } catch (error) {
        if (error instanceof RequestError) {
          return json({ error: error.message, code: error.code, ...error.extras }, error.status);
        }
        return json({ error: 'The coffee collection could not complete this request.', code: 'request_failed' }, 500);
      }
    },
  };
}

export default createApp();
