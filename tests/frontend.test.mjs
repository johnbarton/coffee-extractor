import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const emptyRatings = { overall: null, florality: null, fruitiness: null, brightness: null };
const oldSha = 'a'.repeat(40), currentSha = 'b'.repeat(40), savedSha = 'c'.repeat(40);

function coffee(id, overrides = {}) {
  return {
    id, name: id, roaster: 'Sample Coffee Roasters', roastDate: '2026-08-04',
    status: 'active', statusDate: '2026-08-20', country: null, countries: [],
    varieties: [], process: null, tastingNotes: ['Rose', 'Stone fruit'],
    ratings: { ...emptyRatings }, personalNotes: null, isBlend: false, blendComponents: [],
    ...overrides,
  };
}

const collection = [
  coffee('open-coffee', { name: 'Open coffee', countries: ['Colombia'], varieties: ['Pink Bourbon'], personalNotes: 'A previous brew.' }),
  coffee('resting-coffee', { name: 'Resting coffee', status: 'resting' }),
  coffee('frozen-coffee', { name: 'Frozen coffee', status: 'frozen', statusDate: '2026-09-01' }),
  coffee('finished-coffee', { name: 'Finished coffee', status: 'finished', roaster: 'Another Roaster' }),
  coffee('unknown-coffee', { name: 'Unknown coffee', status: null, statusDate: null }),
];

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function until(predicate, message = 'The interface did not finish updating') {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function mount(t, { path = '/', records = collection, respond } = {}) {
  const dom = new JSDOM(html, { url: `https://coffee.example.workers.dev${path}`, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  // jsdom supplies the DOM and events, not a layout engine or canvas renderer.
  // Supply only the measured chart width; visual layout is verified separately.
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    get() { return this.classList.contains('cc-rating-visual') ? 340 : 0; },
  });
  window.ResizeObserver = class { observe() {} disconnect() {} };
  const calls = [];
  window.fetch = async (url, options = {}) => {
    const call = { url: String(url), method: options.method || 'GET', ...options };
    calls.push(call);
    if (call.url === '__COFFEE_DATA_URL__') return Response.json(records);
    assert.ok(respond, `Unexpected API request: ${call.url}`);
    return respond(call);
  };
  const ready = window.eval(script);
  const document = window.document;
  const query = (selector) => document.querySelector(selector);
  const click = (selector) => {
    const node = query(selector);
    assert.ok(node, `Missing click target: ${selector}`);
    node.click();
  };
  const change = (selector, value) => {
    const node = query(selector);
    assert.ok(node, `Missing input: ${selector}`);
    node.value = value;
    node.dispatchEvent(new window.Event(node.matches('#cc-group, #cc-status') ? 'change' : 'input', { bubbles: true }));
  };
  return { dom, window, document, query, click, change, calls, ready };
}

test('public browsing separates current, frozen, and past bags and keeps missing metadata honest', async (t) => {
  const page = mount(t);
  await page.ready;
  assert.equal(page.query('#cc-now-count').textContent, '2');
  assert.equal(page.query('#cc-frozen-count').textContent, '1');
  assert.equal(page.query('#cc-all-count').textContent, '5');
  assert.equal(page.document.querySelectorAll('[data-bag]').length, 2);
  assert.match(page.query('#cc-description').textContent, /1 open · 1 resting/);
  page.click('[data-bag="open-coffee"]');
  assert.match(page.query('.cc-detail').textContent, /A previous brew\./);
  assert.equal(page.query('[data-editor]'), null);
  assert.equal(page.query('[data-apply]'), null);

  page.click('[data-view="frozen"]');
  assert.equal(page.query('[data-view="frozen"]').getAttribute('aria-pressed'), 'true');
  assert.equal(page.document.querySelectorAll('[data-bag]').length, 1);
  assert.match(page.query('#cc-list').textContent, /Marked frozen/);
  assert.doesNotMatch(page.query('#cc-list').textContent, /days since/);
  page.click('[data-bag="frozen-coffee"]');
  assert.match(page.query('.cc-detail').textContent, /Not recorded/);

  page.click('[data-view="all"]');
  assert.equal(page.query('#cc-filters').hidden, false);
  assert.ok(page.query('[data-bag="finished-coffee"]'));
  page.change('#cc-group', 'variety');
  assert.match(page.query('#cc-list').textContent, /Pink Bourbon/);
  assert.match(page.query('#cc-list').textContent, /Variety not recorded/);
  page.change('#cc-group', 'country');
  assert.match(page.query('#cc-list').textContent, /Origin not recorded/);
  page.change('#cc-status', 'unknown');
  assert.equal(page.document.querySelectorAll('[data-bag]').length, 1);
  assert.ok(page.query('[data-bag="unknown-coffee"]'));
  assert.equal(page.calls.length, 1, 'Public browsing must not call an owner endpoint');
});

test('the ratings chart uses short labels and leaves unrated coffees blank', async (t) => {
  const page = mount(t);
  await page.ready;
  page.click('[data-bag="open-coffee"]');
  const chart = page.query('svg[role="img"]');
  assert.ok(chart);
  for (const label of ['Overall', 'Floral', 'Fruit', 'Bright']) {
    assert.match(chart.getAttribute('aria-label'), new RegExp(`${label}: not rated`));
  }
  assert.equal(chart.querySelectorAll('.cc-radar-point, .cc-radar-profile').length, 0);
  assert.equal(page.query('.cc-ratings-state').textContent, 'Not rated yet');
  assert.doesNotMatch(page.query('#coffee-collection').textContent, /Your ratings|Show example|Design preview/);
  assert.equal(page.query('.cc-ratings').nextElementSibling.querySelector('summary').textContent, 'Brewing notes');
});

test('collection pagination includes all bags when a group spans multiple pages', async (t) => {
  const records = Array.from({ length: 24 }, (_, index) => coffee(`coffee-${index}`, { status: 'finished' }));
  const page = mount(t, { records });
  await page.ready;
  page.click('[data-view="all"]');
  assert.equal(page.document.querySelectorAll('[data-bag]').length, 10);
  assert.equal(page.query('#cc-more').hidden, false);
  page.click('#cc-more');
  assert.equal(page.document.querySelectorAll('[data-bag]').length, 22);
  page.click('#cc-more');
  assert.equal(page.document.querySelectorAll('[data-bag]').length, 24);
  assert.equal(page.query('#cc-more').hidden, true);
});

test('owner editing waits for verified session and a fresh record, then saves its SHA and updates the view', async (t) => {
  const session = deferred(), latest = deferred(), save = deferred();
  const freshCoffee = coffee('open-coffee', {
    name: 'Open coffee', personalNotes: 'A newer brew from another device.',
    ratings: { ...emptyRatings, overall: 2 },
  });
  const page = mount(t, { path: '/owner', respond: (call) => {
    if (call.url.endsWith('/session')) return session.promise;
    return call.method === 'PUT' ? save.promise : latest.promise;
  } });
  await until(() => page.calls.some((call) => call.url.endsWith('/session')));
  assert.equal(page.query('[data-editor]'), null);
  assert.equal(page.calls.filter((call) => call.url.includes('/coffees/')).length, 0);
  session.resolve(Response.json({ owner: true }));
  await page.ready;
  assert.equal(page.query('#cc-view-label').textContent, 'Owner view');
  page.click('[data-bag="open-coffee"]');
  assert.equal(page.query('[data-editor]'), null);
  assert.match(page.query('.cc-detail').textContent, /Loading latest record/);
  latest.resolve(Response.json({ coffee: freshCoffee, sha: currentSha }));
  await until(() => page.query('[data-editor]'));
  assert.equal(page.query('[name="overall"]').value, '2');
  assert.match(page.query('.cc-notes').textContent, /newer brew from another device/);
  assert.equal(page.query('.cc-ratings').nextElementSibling.querySelector('summary').textContent, 'Brewing notes');
  assert.equal(page.query('[data-edit-disclosure]').previousElementSibling.querySelector('summary').textContent, 'Brewing notes');
  page.click('[data-edit-disclosure] summary');
  page.change('[name="status"]', 'frozen');
  page.change('[name="overall"]', '4');
  page.change('[name="fruitiness"]', '5');
  page.change('[name="notes"]', '  Sweet finish.  ');
  page.click('[data-apply]');
  const put = page.calls.find((call) => call.method === 'PUT');
  assert.ok(put);
  assert.deepEqual(JSON.parse(put.body), {
    sha: currentSha, status: 'frozen', ratings: { ...emptyRatings, overall: 4, fruitiness: 5 }, notes: '  Sweet finish.  ',
  });
  assert.equal(put.credentials, 'same-origin');
  assert.equal(put.redirect, 'error');
  assert.equal(put.headers['Content-Type'], 'application/json');
  assert.ok([...page.document.querySelectorAll('[data-editor] select, [data-editor] textarea, [data-editor] button')].every((input) => input.disabled));
  page.click('[data-apply]');
  assert.equal(page.calls.filter((call) => call.method === 'PUT').length, 1);

  const savedCoffee = { ...freshCoffee, status: 'frozen', statusDate: '2026-09-12',
    ratings: { ...emptyRatings, overall: 4, fruitiness: 5 }, personalNotes: `${freshCoffee.personalNotes}\n\nSweet finish.` };
  save.resolve(Response.json({ coffee: savedCoffee, sha: savedSha, unchanged: false }));
  await until(() => /will update after publishing/.test(page.query('#cc-notice').textContent));
  assert.equal(page.query('#cc-now-count').textContent, '1');
  assert.equal(page.query('#cc-frozen-count').textContent, '2');
  assert.equal(page.query('[data-bag="open-coffee"]'), null);
  page.click('[data-view="frozen"]');
  page.click('[data-bag="open-coffee"]');
  assert.equal(page.query('[name="notes"]').value, '');
  assert.equal(page.query('[name="overall"]').value, '4');
  assert.equal(page.query('.cc-notes').textContent, savedCoffee.personalNotes);
  assert.equal(page.query('.cc-ratings-state').textContent, '2 of 4 rated · — not rated');
  assert.equal(page.document.querySelectorAll('.cc-radar-point').length, 2);
  assert.equal(page.query('.cc-radar-profile'), null);
});

test('an unverified owner session leaves only public browsing available', async (t) => {
  const page = mount(t, { path: '/owner', respond: () => Response.json({ code: 'unauthorized', error: 'Please sign in again.' }, { status: 401 }) });
  await page.ready;
  page.click('[data-bag="open-coffee"]');
  assert.equal(page.query('[data-editor]'), null);
  assert.equal(page.query('#cc-owner-link').textContent, 'Owner sign in');
  assert.match(page.query('#cc-notice').textContent, /sign in again/);
  assert.equal(page.calls.filter((call) => call.url.includes('/coffees/')).length, 0);
});

for (const failure of ['conflict', 'save_uncertain']) {
  test(`${failure} preserves the draft and prevents resubmission until the owner loads the latest record`, async (t) => {
    let reads = 0, writes = 0;
    const latestCoffee = coffee('open-coffee', {
      name: 'Open coffee', personalNotes: failure === 'save_uncertain' ? 'The note was saved despite losing the connection.' : 'Another device added this note.',
    });
    const page = mount(t, { path: '/owner', respond: (call) => {
      if (call.url.endsWith('/session')) return Response.json({ owner: true });
      if (call.method === 'GET') {
        reads++;
        return Response.json({ coffee: reads === 1 ? collection[0] : latestCoffee, sha: reads === 1 ? oldSha : currentSha });
      }
      writes++;
      if (writes > 1) return Response.json({ coffee: latestCoffee, sha: currentSha, unchanged: true });
      if (failure === 'save_uncertain') throw new TypeError('Connection closed');
      return Response.json({ code: 'conflict', error: 'This record changed. Load the latest record before saving again.' }, { status: 409 });
    } });
    await page.ready;
    page.click('[data-bag="open-coffee"]');
    await until(() => page.query('[data-editor]'));
    page.click('[data-edit-disclosure] summary');
    page.change('[name="overall"]', '5');
    page.change('[name="notes"]', 'Do not lose this draft.');
    page.click('[data-apply]');
    await until(() => page.query('[data-reload]'));
    assert.equal(page.query('[name="notes"]').value, 'Do not lose this draft.');
    assert.equal(page.query('[name="overall"]').value, '5');
    assert.equal(page.query('[data-apply]').disabled, true);
    assert.equal(page.query('[data-edit-disclosure]').open, true);
    // Even a synthetic click must not duplicate a potentially completed append.
    page.query('[data-apply]').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
    assert.equal(writes, 1);
    page.click('[data-view="all"]');
    page.click('[data-bag="open-coffee"]');
    assert.equal(page.query('[name="notes"]').value, 'Do not lose this draft.');
    assert.equal(page.query('[data-apply]').disabled, true);
    page.click('[data-reload]');
    await until(() => page.query('[data-editor]') && !page.query('[data-apply]').disabled);
    assert.equal(reads, 2);
    assert.equal(page.query('[name="notes"]').value, '');
    assert.equal(page.query('.cc-notes').textContent, latestCoffee.personalNotes);
    page.click('[data-apply]');
    await until(() => page.query('#cc-notice').textContent === 'No changes to save.');
    const retried = page.calls.filter((call) => call.method === 'PUT')[1];
    assert.equal(JSON.parse(retried.body).sha, currentSha);
    assert.equal(JSON.parse(retried.body).notes, '');
  });
}
